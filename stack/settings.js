var stackFunctions = require('../helper/stack_functions');
var githubFunctions = require('../helper/github_functions');
var dropboxFunctions = require('../helper/dropbox_functions');
var gdriveFunctions = require('../helper/gdrive_functions');
var localFunctions = require('../helper/local_functions');

function updateSettings(callback) {
  var payload = JSON.stringify(ls('settings'));
  var done = function (err) {
    if (err) {
      $('#errorreponame').text("Cannot save settings: " + (err.message || err));
      return callback(err.message || err, null);
    }
    return callback(null, "success");
  };
  if (ls('platform') === "Dropbox") {
    dropboxFunctions.createUpdateFile(ls('token'), ls('repoName') + "/fastack_settings", payload, done);
  } else if (ls('platform') === "Google") {
    gdriveFunctions.createUpdateFile(ls('token'), ls('repoName') + "/fastack_settings", payload, done);
  } else if (ls('platform') === "Local") {
    localFunctions.createUpdateFile("", ls('repoName') + "/fastack_settings", payload, done);
  } else {
    githubFunctions.createUpdateFile(ls('token'), ls('username'), ls('repoName'), "fastack_settings", payload, done);
  }
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
function setGlobalVariables(settingsObject) {
  globalShortcut.unregisterAll();
  console.log(settingsObject);
  globalShortcut.register(settingsObject.OpenCloseWindow, function () {
    if (remote.getCurrentWindow().isVisible()) {
      remote.getCurrentWindow().hide();
    } else {
      remote.getCurrentWindow().show();
    }
  });
  globalShortcut.register(settingsObject.NewTask, function () {
    ls('createPage', 'add');
    window.location.replace("./createTask.html");
  });
  globalShortcut.register(settingsObject.ClockIn, function () {
    stackFunctions.clockIn(0);
  });
  globalShortcut.register(settingsObject.ClockOut, function () {
    stackFunctions.clockOut();
  });

  globalShortcut.register(settingsObject.EditTask, function () {
    ls('createPage', 'edit');
    window.location.replace('./createTask.html');
  });

  globalShortcut.register(settingsObject.Logout, function () {
    window.location.replace('../home.html');
  });

  globalShortcut.register(settingsObject.ScrollTaskUp, function () {
    var index = ls('currIndex');
    if (index > 0) {
      index--;
      ls('currIndex', index);
      $('.s1').empty();
      $(".s1").append(stackFunctions.generateFullStackHTML(index));
    }
  });
  globalShortcut.register(settingsObject.ScrollTaskDown, function () {
    var index = ls('currIndex');
    if (index < ls('stack')['incomplete'].length) {
      index++;
      ls('currIndex', index);
      $('.s1').empty();
      $(".s1").append(stackFunctions.generateFullStackHTML(index));
    }
  });

  globalShortcut.register(settingsObject.Settings, function () {
    window.location.replace('./settings.html');
  });

  globalShortcut.register(settingsObject.PopTask, function () {
    var stack = ls('stack');
    if (stack['incomplete'].length > 0) {
      $(".task").first().hide("drop", { direction: "up" }, 1000);
      setTimeout(function () {
        stack['complete'].push(stack['incomplete'][0]);
        stack['incomplete'].shift();

        ls('stack', stack);
        if (ls('stack')['incomplete'].length == 0) {
          ls('createPage', 'add');
          window.location.replace('./createTask.html');
        }
        $('.s1').empty();
        $('.s1').append(stackFunctions.generateFullStackHTML(ls('currIndex') > 0 ? ls('currIndex') - 1 : 0));
      }, 1000);

    }
  });

}
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

};

$(document).ready(function () {

  getCreateSettings(function (err, result) {
    if (!err && result !== "success") {
      settings = result;
    }
    ls('settings', settings);
    console.log(result);
    setGlobalVariables(result);
    if (result.skipTutorial !== true) {

    }
  });
});
