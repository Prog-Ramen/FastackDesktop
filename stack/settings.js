var stackFunctions = require('../helper/stack_functions');

function updateSettings(callback){
  githubFunctions.createUpdateFile(ls('token'), ls('username'), ls('repoName'), "settings", JSON.stringify(ls('settings')), function (err, result) {
    if (err) {
      $('#errorreponame').text("Cannot create a settings file in the repository: " + err.message);
      return callback(err.message, null)
    } else {
      return callback(null, "success")
    }
  });
}

function getCreateSettings(callback) {
  githubFunctions.checkFileExists(ls('token'), ls('username'), ls('repoName'), "fastack_settings", function (err, contentArray) {
    console.log(err);
    console.log(contentArray);
    if (err == null && contentArray.length === 0) {
      githubFunctions.createUpdateFile(ls('token'), ls('username'), ls('repoName'), "fastack_settings", JSON.stringify(settings), function (err, result) {
        if (err) {
          $('#errorreponame').text("Cannot create a settings file in the repository: " + err.message);
          return callback(err.message, null)
        } else {
          return callback(null, "success")
        }
      });
    } else {
      githubFunctions.getContent(ls('token'), ls('username'), "fastack_settings", ls('repoName'), function (err, settingsResults) {
        if (err) {
          $('#errorreponame').text("Cannot get a settings file from the repository: " + err.message);
          return callback(err.message, null);
        } else {
	  console.log(settingsResults['content']);
          return callback(null, JSON.parse(atob(settingsResults['content'].replace(/[^A-Za-z0-9+]/g, ""))));
        }
      });
    }
  });
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

  globalShortcut.register(settingsObject.ScrollTaskUp, function(){
    var index = ls('currIndex');
    if (index > 0){
      index--;
      ls('currIndex', index);
      $('.s1').empty();
      $(".s1").append(stackFunctions.generateFullStackHTML(index));
    } 
  });
  globalShortcut.register(settingsObject.ScrollTaskDown, function(){
    var index = ls('currIndex');
    if (index < ls('stack')['incomplete'].length){
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
    if (stack['incomplete'].length > 0){
    $(".task").first().hide("drop", {direction: "up"}, 1000);
      setTimeout(function(){
        stack['complete'].push(stack['incomplete'][0]);
        stack['incomplete'].shift(); 
        
        ls('stack', stack);
        if (ls('stack')['incomplete'].length == 0){
          ls('createPage', 'add');
          window.location.replace('./createTask.html');
        }  
        $('.s1').empty();
        $('.s1').append(stackFunctions.generateFullStackHTML(ls('currIndex')>0?ls('currIndex')-1:0));
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
