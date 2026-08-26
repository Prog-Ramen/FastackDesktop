// Privacy-preserving activity tracker.
//
// Samples the active application + idle state every SAMPLE_MS during a clock-in
// window. Categorizes the app into a coarse bucket (code/browse/read/write/
// comms/other) and drops the raw window title before it hits disk. Persists
// per-task sessions into whichever backend is active, mirroring the stack
// layout: <repo>/activity/<year>/<month>/<day>.json
//
// A session record:
//   { taskName, startTs, endTs, samples: [{ ts, app, category, idle }] }
//
// `app` is the process/owner name only (e.g. "Visual Studio Code") — never the
// window title. `idle` is a boolean derived from powerMonitor.getSystemIdleTime.

var ls = require('local-storage');
var githubFunctions = require('./github_functions');
var dropboxFunctions = require('./dropbox_functions');
var gdriveFunctions = require('./gdrive_functions');
var localFunctions = require('./local_functions');

var SAMPLE_MS = 5000;
var IDLE_THRESHOLD_SEC = 30;

var currentSession = null;
var sampleTimer = null;

function categorize(appName) {
  var a = (appName || '').toLowerCase();
  if (/code|xcode|intellij|pycharm|webstorm|sublime|atom|vim|neovim|emacs|cursor|zed|android studio|rider|clion|goland|rubymine|terminal|iterm|warp|hyper|alacritty|kitty/.test(a)) return 'code';
  if (/chrome|safari|firefox|edge|brave|arc|opera|vivaldi/.test(a)) return 'browse';
  if (/preview|adobe|acrobat|kindle|reader|books|foxit/.test(a)) return 'read';
  if (/word|pages|notion|obsidian|bear|ulysses|typora|scrivener|google docs|onenote/.test(a)) return 'write';
  if (/slack|discord|zoom|teams|mail|outlook|messages|whatsapp|telegram|signal|skype/.test(a)) return 'comms';
  return 'other';
}

// active-win on macOS spawns a helper binary that requests Screen Recording
// permission the first time it runs. That permission prompt steals focus,
// blurs the popup, and hides it — a jarring side-effect of pressing Alt+C.
// For v1 we skip per-app breakdown entirely and only sample idle state via
// powerMonitor, which needs no permission and doesn't disturb the popup.
// (Set FASTACK_TRACK_APPS=1 in dev if you've already granted the prompt.)
var trackApps = process && process.env && process.env.FASTACK_TRACK_APPS === '1';
var activeWinDisabled = !trackApps;

function takeSample() {
  if (!currentSession) return;
  var app = 'unknown';
  var idle = false;
  try {
    var remote = require('@electron/remote');
    var idleSec = remote.powerMonitor.getSystemIdleTime();
    idle = idleSec >= IDLE_THRESHOLD_SEC;
  } catch (e) { /* powerMonitor unavailable */ }
  if (!currentSession) return;
  currentSession.samples.push({
    ts: Date.now(),
    app: app,
    category: idle ? 'idle' : 'other',
    idle: idle
  });
  if (activeWinDisabled) return;
  // Opt-in path: probe active-win asynchronously and patch the sample we just
  // pushed if we get a result. Never blocks the timer and never disturbs the
  // popup on the sync path above.
  (async function () {
    try {
      var mod = await import('active-win');
      var win = await mod.default();
      if (win && win.owner && win.owner.name && currentSession && currentSession.samples.length) {
        var last = currentSession.samples[currentSession.samples.length - 1];
        last.app = win.owner.name;
        if (!last.idle) last.category = categorize(win.owner.name);
      }
    } catch (e) { activeWinDisabled = true; }
  })();
}

// Fire-and-forget: the tracker must not block clock-in.
exports.start = function (taskName) {
  if (currentSession) exports.stop(function () { });
  currentSession = {
    taskName: taskName || 'untitled',
    startTs: Date.now(),
    endTs: null,
    samples: []
  };
  // Take one immediate sample so short focus windows still register.
  takeSample();
  sampleTimer = setInterval(takeSample, SAMPLE_MS);
};

exports.stop = function (callback) {
  var cb = callback || function () { };
  if (!currentSession) return cb(null);
  if (sampleTimer) { clearInterval(sampleTimer); sampleTimer = null; }
  currentSession.endTs = Date.now();
  var session = currentSession;
  currentSession = null;

  var d = new Date();
  var datePath = 'activity/' + d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate();
  var platform = ls('platform');
  var repo = ls('repoName') || 'local';

  // Read the current day file, append this session, write back. Same pattern
  // for every backend — content is always JSON text.
  var readAndAppend = function (getText, putText) {
    getText(function (err, prev) {
      var arr = [];
      if (!err && prev) {
        try { arr = JSON.parse(prev); if (!Array.isArray(arr)) arr = []; } catch (e) { arr = []; }
      }
      arr.push(session);
      putText(JSON.stringify(arr), cb);
    });
  };

  if (platform === 'Github') {
    readAndAppend(
      function (done) {
        githubFunctions.getContent(ls('token'), ls('username'), datePath, repo, function (e, r) {
          if (e || !r) return done(e || new Error('nofile'), null);
          try { done(null, atob((r.content || '').replace(/[^A-Za-z0-9+/=]/g, ''))); }
          catch (er) { done(er, null); }
        });
      },
      function (text, done) {
        githubFunctions.createUpdateFile(ls('token'), ls('username'), repo, datePath, text, done);
      }
    );
  } else if (platform === 'Dropbox') {
    readAndAppend(
      function (done) { dropboxFunctions.getContent(ls('token'), '/' + repo + '/' + datePath, done); },
      function (text, done) { dropboxFunctions.createUpdateFile(ls('token'), repo + '/' + datePath, text, done); }
    );
  } else if (platform === 'Google') {
    readAndAppend(
      function (done) { gdriveFunctions.getContent(ls('token'), repo + '/' + datePath, done); },
      function (text, done) { gdriveFunctions.createUpdateFile(ls('token'), repo + '/' + datePath, text, done); }
    );
  } else {
    readAndAppend(
      function (done) { localFunctions.getContent('', repo + '/' + datePath, done); },
      function (text, done) { localFunctions.createUpdateFile('', repo + '/' + datePath, text, done); }
    );
  }
};

exports.isRunning = function () { return currentSession !== null; };

exports.currentTaskName = function () { return currentSession ? currentSession.taskName : null; };

// Exposed for the report page so it can categorize on the fly if needed.
exports.categorize = categorize;
