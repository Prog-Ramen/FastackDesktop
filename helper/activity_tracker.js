// Privacy-preserving activity tracker.
//
// Samples idle state + user activity signals every SAMPLE_MS during a clock-in
// window. No app names, no window titles, no screen recording — just behavioral
// signals from the keyboard and mouse:
//
//   - keyboardCount: number of keydown events in the interval
//   - scrollCount:   number of wheel (scroll) events in the interval
//
// Categorization (done per 5s sample):
//   idle    → powerMonitor says user is idle (30s+ no input)
//   write   → keyboard >> scroll (dominant typing)
//   read    → scroll >> keyboard (dominant scrolling)
//   browse  → moderate activity, low keyboard (mouse-driven)
//   other   → active but unclear pattern
//
// A session record:
//   { taskName, startTs, endTs, samples: [{ ts, category, idle }] }
//
// Persists per-task sessions into whichever backend is active:
// <repo>/activity/<year>/<month>/<day>.json

var ls = require('local-storage');
var githubFunctions = require('./github_functions');
var dropboxFunctions = require('./dropbox_functions');
var gdriveFunctions = require('./gdrive_functions');
var localFunctions = require('./local_functions');

var SAMPLE_MS = 5000;
var IDLE_THRESHOLD_SEC = 30;

var currentSession = null;
var sampleTimer = null;

// Last-known activity signals, set by the renderer via recordActivity().
var lastKeyboardCount = 0;
var lastScrollCount = 0;

/**
 * Called by the renderer (stack.js) on each sample interval with counts of
 * keydown and wheel events observed since the last sample.
 */
exports.recordActivity = function (keyboardCount, scrollCount) {
  lastKeyboardCount = keyboardCount || 0;
  lastScrollCount = scrollCount || 0;
};

function categorizeFromSignals(idle) {
  if (idle) return 'idle';
  var kb = lastKeyboardCount || 0;
  var sc = lastScrollCount || 0;
  // Dominant typing = writing
  if (kb >= 3 && kb > sc * 2) return 'write';
  // Dominant scrolling = reading
  if (sc >= 2 && sc > kb * 2) return 'read';
  // Mouse-driven with little typing = browsing
  if (sc >= 1 && kb < 3) return 'browse';
  // Active but unclear
  return 'other';
}

function takeSample() {
  if (!currentSession) return;
  var idle = false;
  try {
    var remote = require('@electron/remote');
    var idleSec = remote.powerMonitor.getSystemIdleTime();
    idle = idleSec >= IDLE_THRESHOLD_SEC;
  } catch (e) { /* powerMonitor unavailable */ }
  if (!currentSession) return;
  currentSession.samples.push({
    ts: Date.now(),
    category: categorizeFromSignals(idle),
    idle: idle
  });
  // Reset signals for the next interval.
  lastKeyboardCount = 0;
  lastScrollCount = 0;
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
