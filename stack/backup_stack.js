const {globalShortcut} = remote;
const { BrowserWindow } = require('@electron/remote');
const remote = require('@electron/remote');
const path = require('path');
const $ = require('jquery');
var Editor = require('tui-editor');
const electron = require('electron');
const base64 = require('base-64');
var ls = require('local-storage');
var githubFunctions = require('../helper/github_functions');
var {ipcRenderer} = require('electron').remote;
var cryptoHelper = require('../helper/crypto_helper');
require('tui-editor/dist/tui-editor-extChart');
require('tui-editor/dist/tui-editor-extUML');

var window = BrowserWindow.getFocusedWindow();


$(document).ready(function () {
  $("body").css("background-color", "transparent");
  $("ul li:nth-child(2)").append("<span> - 2nd!</span>");

  function getCreateSettings(callback) {
    githubFunctions.checkFileExists(ls('token'), ls('username'), ls('repoName'), "settings", function (err, contentArray) {
      if (err == null && contentArray === "") {
        githubFunctions.createUpdateFile(ls('token'), ls('username'), ls('repoName'), "settings", base64.encode(JSON.stringify(settings)), function (err, result) {
          if (err) {
            $('#errorreponame').text("Cannot create a settings file in the repository: " + err.message);
            return callback(err.message, null)
          } else {
            return callback(null, "success")
          }
        });
      } else {
        githubFunctions.getContent(ls('token'), ls('username'), contentArray, ls('repoName'), function (err, settingsResults) {
          if (err) {
            $('#errorreponame').text("Cannot get a settings file from the repository: " + err.message)
            return callback(err.message, null);
          } else {
            return callback(null, JSON.parse(base64.decode(settingsResults['content'])));
          }
        });
      }
    });
  }

  function lookForStack(callback) {
    githubFunctions.getContent(ls('token'), ls('username'), "", ls('repoName'), function (err, contentArray) {
      if (err) {
        return callback(err, null);
      }
      largestYear = 0;
      var fileNum = contentArray.length;
      for (var fileCount = 0; fileCount < fileNum; fileCount++) {
        var fourDigits = /^\d{4}$/;
        if (fourDigits.test(contentArray[fileCount].name)) {
          if (Integer.parseInt(contentArray[fileCount].name) > largestYear) {
            largestYear = Integer.parseInt(contentArray[fileCount].name)
          }
        }
      }
      if (largestYear === 0) {
        return callback(null, null);
      }
      githubFunctions.getContent(ls('token'), ls('username'), Integer.toString(largestYear), ls('repoName'), function (err, contentArray) {
        if (err) {
          return callback(err, null);
        }
        largestMonth = 0;
        var fileNum = contentArray.length;
        for (var fileCount = 0; fileCount < fileNum; fileCount++) {
          var twoDigits = /^\d{2}$/;
          if (twoDigits.test(contentArray[fileCount].name)) {
            if (Integer.parseInt(contentArray[fileCount].name) > largestMonth) {
              largestMonth = Integer.parseInt(contentArray[fileCount].name)
            }
          }
        }
        if (largestMonth === 0) {
          return callback(null, null);
        }
        githubFunctions.getContent(ls('token'), ls('username'), Integer.toString(largestYear) + "/" + Integer.toString(largestMonth), ls('repoName'), function (err, contentArray) {
          if (err) {
            return callback(err, null);
          }
          largestDay = 0
          var fileNum = contentArray.length
          for (var fileCount = 0; fileCount < fileNum; fileCount++) {
            var twoDigits = /^\d{2}$/;
            if (twoDigits.test(contentArray[fileCount].name)) {
              if (Integer.parseInt(contentArray[fileCount].name) > largestDay) {
                largestDay = Integer.parseInt(contentArray[fileCount].name)
              }
            }
          }
          if (largestDay === 0) {
            return callback(null, null);
          } else {
            githubFunctions.getContent(ls('token'), ls('username'), Integer.toString(largestYear) + "/" + Integer.toString(largestMonth) + "/" + Integer.toString(largestDay), ls('repoName'), function (err, results) {
              if (err) {
                return callback(err, null);
              } else {
                stack = JSON.parse(base64.decode(results['content']));
                return callback(null, stack);
              }
            });
          }
        });
      });
    });
  }

  function setGlobalVariables(settingsObject) {
    globalShortcut.register(settingsObject.openClose, function () {
      if (remote.getCurrentWindow().isVisible()) {
        remote.getCurrentWindow().hide();
      } else {
        remote.getCurrentWindow().show();
      }
    });
  }

  function fixStepIndicator(n) {
    // This function removes the "active" class of all steps...
    var i, x = document.getElementsByClassName("step");
    var numSteps = x.length;
    for (i = 0; i < numSteps; i++) {
      x[i].className = x[i].className.replace(" active", "");
    }
    //... and adds the "active" class on the current step:
    x[n].className += " active";
  }

  //function createTask
  function createTask(stack) {
    stack
  }

  $('#tdate').bind('input propertychange', function () {
    console.log($('#tdate').val());
  });

  let screen = electron.screen;
  let displays = screen.getAllDisplays();
  var width = 0;
  var totalDisplays = displays.length;
  for (var displayInd = 0; displayInd < totalDisplays; displayInd++) {
    width = width + displays[displayInd].bounds.width;
  }

  var tuiWindow = new BrowserWindow({
    width: 300, height: 500, show: false, frame: false,
    resizable: true,
    hasShadow: false
  });
  setTimeout(function () {
    console.log($("textarea"));
    $("textarea").focus(function (evt) {
      evt.preventDefault();
      if ($(".CodeMirror-focused").length > 0) {
        remote.getCurrentWindow().webContents.send('get_data_write', "hereeee");
        console.log('focused');
        tuiWindow.showInactive();
      }
    });
    // $("textarea").focusout(function (evt) {
    //   evt.preventDefault();
    //   setTimeout(function () {
    //     console.log($(".CodeMirror-focused").is(":visible"));
    //     console.log('out of focus');
    //     if ($(".CodeMirror-focused").length == 0) {
    //       tuiWindow.hide();
    //     }
    //   }, 100);
    //
    // });
  }, 3000);
  remote.getCurrentWindow().show();
  tuiWindow.setPosition(remote.getCurrentWindow().getPosition()[0] - 300, remote.getCurrentWindow().getPosition()[1]);

  var editor = new Editor({
    el: document.querySelector('#editSection'),
    previewStyle: 'tab',
    initialEditType: 'markdown',
    height: '300px',
    width: '200px',
    exts: ['scrollSync', 'uml', {
      name: 'chart',
      maxWidth: 200,
      maxHeight: 300
    }, 'mark', 'table', 'taskCounter']
  });

  var stack = [];
  lookForStack(function (err, stackValue) {
    if (err) {
      $('#errorreponame').text("Cannot get the current stack from the repository: " + err.message);
    } else if (stackValue) {
      stack = stackValue;
    }
    if (stack.length === 0) {
      $('#createtask').on('click', function () {
        console.log("GOTHERE");
      });
    } else {

    }

  });
  var settings = {
    "openClose": "alt+z",
    "nextPageTask": "Alt+Down",
    "prevPageTask": "Alt+Up"
  };
  getCreateSettings(function (err, result) {
    if (!err && result !== "success") {
      settings = result;
    }
    setGlobalVariables(result);
    if (result.skipTutorial !== true) {

    }
  });
});
