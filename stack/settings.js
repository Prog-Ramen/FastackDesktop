var stackFunctions = require('../helper/stack_functions');
var intelligence = require('../helper/intelligence');
var githubFunctions = require('../helper/github_functions');
var dropboxFunctions = require('../helper/dropbox_functions');
var gdriveFunctions = require('../helper/gdrive_functions');
var localFunctions = require('../helper/local_functions');
var tutorial = require('../helper/tutorial');
var shortcutContext = require('../helper/shortcut_context');
// NOTE: don't declare `var remote = ...` here — stack.js / createTask.js
// already do `const remote = ...` in the same classic-script scope and a
// re-declaration throws SyntaxError, which halts this whole file.
var __remote = require('@electron/remote');
var __ipc = require('electron').ipcRenderer;
__ipc.removeAllListeners('window-layout-changed');
__ipc.on('window-layout-changed', function (_event, layout) { if (layout && layout.preset) ls('windowSizePreset', layout.preset); });

// On macOS, Electron's globalShortcut consumes the key event before the DOM
// sees it — so the tour's window-level keydown listener never fires. Each
// registered callback below pings the tour explicitly so shortcut-gated
// steps advance on the platform's real trigger.
function notifyTour(key) {
  try { tutorial.notifyShortcut(key); } catch (e) { /* tour not loaded on this page */ }
}

function updateSettings(callback) {
  var payload = JSON.stringify(ls('settings'));
  var done = function (err) {
    if (err) {
      $('#errorreponame').text("Cannot save settings: " + (err.message || err));
      return callback(err.message || err, null);
    }
    return callback(null, "success");
  };
  // Settings are always mirrored locally before being written remotely.
  localFunctions.createUpdateFile("", "local/fastack_settings", payload, function (localErr) {
    if (localErr) return done(localErr);
  if (ls('platform') === "Dropbox") {
    dropboxFunctions.createUpdateFile(ls('token'), ls('repoName') + "/fastack_settings", payload, done);
  } else if (ls('platform') === "Google") {
    gdriveFunctions.createUpdateFile(ls('token'), ls('repoName') + "/fastack_settings", payload, done);
  } else if (ls('platform') === "Local") {
    localFunctions.createUpdateFile("", ls('repoName') + "/fastack_settings", payload, done);
  } else {
    githubFunctions.createUpdateFile(ls('token'), ls('username'), ls('repoName'), "fastack_settings", payload, done);
  }
  });
}

function deliverContextShortcut(scope, key) {
  var api = window.FastackContextShortcuts;
  if (api && api.scope === scope && typeof api.run === 'function') {
    api.run(key);
    return;
  }
  // A global shortcut can arrive during the small interval between page load
  // and document-ready. Preserve it for the page instead of falling through
  // to a task command or silently dropping it.
  window.__fastackPendingContextShortcut = { scope: scope, key: key };
}

function getCreateSettings(callback) {
  if (ls('platform') === "Github") {
    githubFunctions.getContent(ls('token'), ls('username'), "fastack_settings", ls('repoName'), function (err, settingsResults) {
      if (err) {
        $('#errorreponame').text("Cannot get a settings file from the repository: " + err.message);
        githubFunctions.createUpdateFile(ls('token'), ls('username'), ls('repoName'), "fastack_settings", JSON.stringify(settings), function (err, result) {
          if (err) {
            $('#errorreponame').text("Cannot create a settings file in the repository: " + err.message);
            return callback(err.message, null)
          } else {
            return callback(null, "success")
          }
        });
      } else {
        console.log(settingsResults['content']);
        return callback(null, JSON.parse(atob(settingsResults['content'].replace(/[^A-Za-z0-9+]/g, ""))));
      }
    });
  } else if (ls('platform') === "Dropbox") {
    dropboxFunctions.getContent(ls('token'), "/" + ls('repoName') + "/fastack_settings", function (err, settingsResults) {
      if (err) {
        dropboxFunctions.createUpdateFile(ls('token'), ls('repoName') + "/fastack_settings", JSON.stringify(settings), function (err) {
          if (err) {
            $('#errorreponame').text("Cannot create a settings file in the repository: " + (err.message || err));
            return callback(err.message || err, null);
          }
          return callback(null, "success");
        });
      } else {
        try { return callback(null, JSON.parse(settingsResults)); }
        catch (e) { return callback(null, "success"); }
      }
    });
  } else if (ls('platform') === "Google") {
    gdriveFunctions.getContent(ls('token'), ls('repoName') + "/fastack_settings", function (err, settingsResults) {
      if (err || !settingsResults) {
        gdriveFunctions.createUpdateFile(ls('token'), ls('repoName') + "/fastack_settings", JSON.stringify(settings), function (err) {
          if (err) {
            $('#errorreponame').text("Cannot create a settings file in the repository: " + (err.message || err));
            return callback(err.message || err, null);
          }
          return callback(null, "success");
        });
      } else {
        try { return callback(null, JSON.parse(settingsResults)); }
        catch (e) { return callback(null, "success"); }
      }
    });
  } else if (ls('platform') === "Local") {
    localFunctions.getContent("", ls('repoName') + "/fastack_settings", function (err, settingsResults) {
      if (err || !settingsResults) {
        localFunctions.createUpdateFile("", ls('repoName') + "/fastack_settings", JSON.stringify(settings), function (err) {
          if (err) return callback(err.message || err, null);
          return callback(null, "success");
        });
      } else {
        try { return callback(null, JSON.parse(settingsResults)); }
        catch (e) { return callback(null, "success"); }
      }
    });
  }
}
var pageAlive = true;

// Shortcuts are registered in the MAIN process (see main.js `register-shortcuts`
// handler). Main runs a plain arrow when the accelerator fires and IPCs the
// shortcut name here. No renderer closures are held in main, so navigating
// pages can never leave a "Render frame was disposed" stale callback.
function setGlobalVariables(settingsObject) {
  __ipc.send('register-shortcuts', [
    { key: 'OpenCloseWindow', accel: settingsObject.OpenCloseWindow },
    { key: 'NewTask',         accel: settingsObject.NewTask },
    { key: 'ClockIn',         accel: settingsObject.ClockIn },
    { key: 'ClockOut',        accel: settingsObject.ClockOut },
    { key: 'EditTask',        accel: settingsObject.EditTask },
    { key: 'Logout',          accel: settingsObject.Logout },
    { key: 'ScrollTaskUp',    accel: settingsObject.ScrollTaskUp },
    { key: 'ScrollTaskDown',  accel: settingsObject.ScrollTaskDown },
    { key: 'Settings',        accel: settingsObject.Settings },
    { key: 'PopTask',         accel: settingsObject.PopTask },
    { key: 'WindowSize',      accel: settingsObject.WindowSize },
    { key: 'ResetWindowPosition', accel: settingsObject.ResetWindowPosition }
    ,{ key: 'NavigateLeft',    accel: settingsObject.NavigateLeft }
    ,{ key: 'NavigateRight',   accel: settingsObject.NavigateRight }
    ,{ key: 'OpenTask',        accel: settingsObject.OpenTask }
    ,{ key: 'Back',            accel: settingsObject.Back }
    ,{ key: 'ShortcutCompass', accel: settingsObject.ShortcutCompass }
  ]);
}

// A page may load settings.js more than once (e.g. included from two HTML
// files). Clear prior handler so we don't double-run.
__ipc.removeAllListeners('shortcut');
__ipc.on('shortcut', function (_evt, key) {
  if (!pageAlive) return;
  try {
    var route = shortcutContext.route(location.pathname, key);
    var pageName = route.page;
    if (route.scope === 'lists') {
      deliverContextShortcut('lists', key);
      return;
    }
    if (route.scope === 'sops') {
      deliverContextShortcut('sops', key);
      return;
    }
    // Entity shortcuts may never leak into a hidden task stack. Pages without
    // a selectable entity simply ignore them.
    if (route.scope === 'none') return;
    if (key === 'OpenCloseWindow') {
      if (__remote.getCurrentWindow().isVisible()) __remote.getCurrentWindow().hide();
      else __remote.getCurrentWindow().show();
      notifyTour('OpenCloseWindow');
    } else if (key === 'NewTask') {
      ls('createPage', 'add');
      notifyTour('NewTask');
      window.location.replace('./createTask.html');
    } else if (key === 'ClockIn') {
      var clockIndex = parseInt(ls('currIndex'), 10) || 0;
      var taskCount = (ls('stack') && ls('stack').incomplete || []).length;
      if (taskCount) { var target = Math.max(0, Math.min(clockIndex, taskCount - 1)), targetTask = ls('stack').incomplete[target]; if (targetTask.lock && targetTask.lock.owner !== ls('fastackDeviceId')) { if (confirm('This task has a timer running on another platform. Transfer the timer to this device?')) { delete targetTask.lock; delete targetTask.timerHandoff; ls('stack', ls('stack')); stackFunctions.clockIn(target); } } else stackFunctions.clockIn(target); }
      notifyTour('ClockIn');
    } else if (key === 'ClockOut') {
      stackFunctions.clockOut();
      notifyTour('ClockOut');
    } else if (key === 'EditTask') {
      ls('createPage', 'edit');
      notifyTour('EditTask');
      window.location.replace('./createTask.html');
    } else if (key === 'Logout') {
      var leave = function () { __ipc.invoke('window:set-size', 'standard').finally(function () { window.location.replace('../home.html'); }); };
      if (stackFunctions.isClockedIn()) return stackFunctions.clockOut(leave);
      leave();
    } else if (key === 'ScrollTaskUp') {
      var iu = ls('currIndex');
      if (iu > 0) {
        iu--;
        ls('currIndex', iu);
        $('.s1').empty();
        $('.s1').append(stackFunctions.generateFullStackHTML(iu));
      }
      notifyTour('ScrollTaskUp');
    } else if (key === 'ScrollTaskDown') {
      var id = ls('currIndex');
      if (id < ls('stack')['incomplete'].length - 1) {
        id++;
        ls('currIndex', id);
        $('.s1').empty();
        $('.s1').append(stackFunctions.generateFullStackHTML(id));
      }
      notifyTour('ScrollTaskDown');
    } else if (key === 'Settings') {
      notifyTour('Settings');
      window.location.replace('./settings.html');
    } else if (key === 'PopTask') {
      var stack = ls('stack');
      if (stack['incomplete'].length > 0) {
        $('.task').first().addClass('is-popping').hide('drop', { direction: 'up' }, 260);
        setTimeout(function () {
          if (!pageAlive) return;
          var completedTask = stack['incomplete'][0];
          completedTask.completedAt = new Date().toISOString();
          completedTask.completionSummary = intelligence.completionSummary(completedTask);
          stack['complete'].push(completedTask);
          stack['incomplete'].shift();
          ls('stack', stack);
          stackFunctions.persistStack(function (saveErr) {
          if (saveErr) console.error('[fastack] pop persistence failed:', saveErr);
          if (ls('stack')['incomplete'].length == 0 && ls('tourActive') !== true) {
            ls('createPage', 'add');
            window.location.replace('./createTask.html');
          }
          $('.s1').removeClass('pop-refresh');
          $('.s1').empty().append(stackFunctions.generateFullStackHTML(ls('currIndex') > 0 ? ls('currIndex') - 1 : 0));
          requestAnimationFrame(function () { $('.s1').addClass('pop-refresh'); setTimeout(function () { $('.s1').removeClass('pop-refresh'); }, 340); });
          });
        }, 270);
        notifyTour('PopTask');
      }
    } else if (key === 'WindowSize') {
      __ipc.invoke('window:get-layout').then(function (layout) { if (layout) ls('windowSizePreset', layout.preset); });
    } else if (key === 'ResetWindowPosition') {
      // Main handles reset directly so this shortcut works on every page.
    } else if (key === 'NavigateLeft' || key === 'NavigateRight') {
      var page = location.pathname.split('/').pop(), pages = ['stack.html', 'report.html', 'sops.html', 'taskLists.html'], pageIndex = pages.indexOf(page);
      if (pageIndex >= 0) { var pageNext = Math.max(0, Math.min(pages.length - 1, pageIndex + (key === 'NavigateLeft' ? -1 : 1))); if (pageNext !== pageIndex) window.location.replace('./' + pages[pageNext]); return; }
      var tabs = Array.prototype.slice.call(document.querySelectorAll('.tabs .tab,[role="tab"]'));
      if (tabs.length) {
        var active = Math.max(0, tabs.findIndex(function (tab) { return tab.classList.contains('active') || tab.getAttribute('aria-selected') === 'true'; }));
        var next = Math.max(0, Math.min(tabs.length - 1, active + (key === 'NavigateLeft' ? -1 : 1)));
        tabs[next].click(); tabs[next].focus();
      }
    } else if (key === 'OpenTask') {
      if (/stack\.html$/.test(location.pathname) && (ls('stack').incomplete || []).length) window.location.replace('./taskDetail.html');
    } else if (key === 'Back') {
      if (!/stack\.html$/.test(location.pathname)) window.location.replace('./stack.html');
    } else if (key === 'ShortcutCompass') {
      if (window.FastackCompass) window.FastackCompass.toggle();
    }
  } catch (e) { console.error('[fastack] shortcut failed:', key, e); }
});

window.addEventListener('beforeunload', function () {
  pageAlive = false;
  try { __ipc.removeAllListeners('shortcut'); } catch (e) { /* noop */ }
});
var settings = {
  "OpenCloseWindow": "Alt+Z",
  "NewTask": "Alt+N",
  "ClockIn": "Alt+C",
  "ClockOut": "Alt+V",
  "Settings": "Alt+S",
  "PopTask": "Alt+P",
  "ScrollTaskUp": "Alt+Up",
  "ScrollTaskDown": "Alt+Down",
  "EditTask": "Alt+E",
  "Logout": "Alt+L",
  "WindowSize": "Alt+Shift+S",
  "ResetWindowPosition": "Alt+Shift+R",
  "NavigateLeft": "Alt+Left",
  "NavigateRight": "Alt+Right",
  "OpenTask": "Alt+Enter",
  "Back": "Alt+Backspace",
  "ShortcutCompass": "Alt+/",

};

$(document).ready(function () {
  __ipc.invoke('window:set-size', ls('windowSizePreset') || 'standard').catch(function () {});

  getCreateSettings(function (err, result) {
    // getCreateSettings returns either the parsed settings object OR the string "success"
    // (when it had to create the file for the first time / when the file was unparseable).
    // In the "success" case we fall back to the defaults so globalShortcut still registers.
    if (!err && result && typeof result === 'object') {
      // Merge loaded settings on top of defaults so any keys added in a later version
      // still have a binding.
      Object.keys(result).forEach(function (k) { settings[k] = result[k]; });
    }
    ls('settings', settings);
    setGlobalVariables(settings);
  });
});
