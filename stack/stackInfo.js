
const { BrowserWindow } = require('@electron/remote');
const remote = require('@electron/remote');
const path = require('path')
var $ = require('jquery');
const electron = require('electron');
const base64 = require('base-64');
var ls = require('local-storage');
var githubFunctions = require('../helper/github_functions');
var dropboxFunctions = require('../helper/dropbox_functions');
var gdriveFunctions = require('../helper/gdrive_functions');
var conversions = require('../helper/conversions');
var prestack = require('../helper/prestack_functions');
var randomBytes = require('randombytes');
var cryptoHelper = require('../helper/crypto_helper');


var window = BrowserWindow.getAllWindows()[0];


$(document).ready(function () {
  remote.getCurrentWindow().show();
  function repoAlreadyExists() {
    if (ls("repoName")) {
      $("#reponame").hide();
      $("#checkBoxText").hide();
      $("#works").hide();
      ls('createPage', 'add');
    }
  }
  function handleInputAndHistory() {
    $("#reponame").val(ls("repoNameInput"));
  }

  handleInputAndHistory();
  repoAlreadyExists();
  $('#repoBack').on('click', function () {
    window.location.replace("./stack_name.html");
  });
  $('#works').on('click', function () {
    ls("repoNameInput", $("#reponame").val());
    window.location.replace("./stack_info.html");
  });
  $('#backButton').on('click', function () {
    window.location.replace("../home.html");
  });
  var id = null;
  function errorLog(message) {
    if (id) {
      clearTimeout(id);
      id = null;
    }
    $('#errorDropdown').addClass("trigger");
    $('#errorDropdown').html('<img id="errorsign" src="../images/error.svg" alt="FaStack Logo" width="2000" height="2000"><b>Error</b>: ' + message);
    id = setTimeout(function () {
      $('#errorDropdown').removeClass("trigger");
    }, 4000);
  }

  function githubRepoSetup() {
    $('#RepoNameSubmit').on('submit', function (evt) {
      evt.preventDefault();
      var repoName = $("#reponame")[0].value;
      $('#errorreponame').text("");
      var reRepo = /^[A-Za-z0-9_.-]+$/;
      if (repoName === "" && !ls("repoName")) {
        errorLog("Repository name cannot be empty.");
      } else if (!reRepo.test(repoName) && !ls("repoName")) {
        errorLog("Repository name can only contain: upper/lower case alphabets, underscores, periods, and dashes.");
      } else {
        var password = ""
        if (!ls("repoName")) {
          privateRepo = true;
          githubFunctions.makeRepo(ls('token'), repoName, privateRepo, function (err, result) {
            if (err) {
              errorLog(`Repository creation failed: Ensure a repository with the same name does not exist.`);
            } else {
              ls('stack', { 'complete': [], 'incomplete': [] });
              var fileContent = "";
              ls('key', null);

              githubFunctions.createUpdateFile(ls('token'), ls('username'), repoName, `fastack-0-${ls('username')}`, fileContent, function (err, result) {
                if (err) {
                  $('#errorreponame').text("Cannot create an identifier file in the repository: " + err);
                } else {
                  ls('key', password);
                  ls('repoName', repoName);
                  ls('createPage', 'add');
                  //window.location.replace("./createTask.html");
                }
              });
            }
          });
        } else {
          ls('key', password);
          prestack.lookForStack(function (err, stackValue) {
            if (err) {
              $('#errorreponame').text("Cannot get the current stack from the repository: " + err.message);
            }
            ls('stack', stackValue ? stackValue : { 'complete': [], 'incomplete': [] });
            if (ls('stack')['incomplete'].length === 0) {
              ls('createPage', 'add');
              //window.location.replace("./createTask.html");
            } else {
              //window.location.replace("./stack.html");
            }
          });
        }

      }
    });
  }

  function dropboxFolderSetup () {
    $('#RepoNameSubmit').on('submit', function (evt) {
      evt.preventDefault();
      var repoName = $("#reponame")[0].value;
      $('#errorreponame').text("");
      var reRepo = /^[A-Za-z0-9_.-]+$/;
      if (repoName === "" && !ls("repoName")) {
        errorLog("Repository name cannot be empty.");
      } else if (!reRepo.test(repoName) && !ls("repoName")) {
        errorLog("Repository name can only contain: upper/lower case alphabets, underscores, periods, and dashes.");
      } else {
        var password = ""
        if (!ls("repoName")) {
          dropboxFunctions.makeRepo(ls('token'), repoName, function (err, result) {
            if (err) {
              errorLog(`Repository creation failed: Ensure a repository with the same name does not exist.`);
            } else {
              ls('stack', { 'complete': [], 'incomplete': [] });
              var fileContent = "";
              ls('key', null);

              ls('key', password);
              ls('repoName', "Fastack-" + repoName);
              ls('createPage', 'add');
              window.location.replace("./createTask.html");
            }
          });
          
        } else {
          ls('key', password);
          prestack.lookForStackDropBox(function (err, stackValue) {
            if (err) {
              $('#errorreponame').text("Cannot get the current stack from the repository: " + err.message);
            }
            ls('stack', stackValue ? stackValue : { 'complete': [], 'incomplete': [] });
            if (ls('stack')['incomplete'].length === 0) {
              ls('createPage', 'add');
              //window.location.replace("./createTask.html");
            } else {
              //window.location.replace("./stack.html");
            }
          });
        }

      }
    }); 
  }

  function gdriveFolderSetup() {
    $('#RepoNameSubmit').on('submit', function (evt) {
      evt.preventDefault();
      var repoName = $("#reponame")[0].value;
      $('#errorreponame').text("");
      var reRepo = /^[A-Za-z0-9_.-]+$/;
      if (repoName === "" && !ls("repoName")) {
        errorLog("Folder name cannot be empty.");
        return;
      }
      if (!reRepo.test(repoName) && !ls("repoName")) {
        errorLog("Folder name can only contain: upper/lower case alphabets, underscores, periods, and dashes.");
        return;
      }
      var password = "";
      if (!ls("repoName")) {
        gdriveFunctions.makeRepo(ls('token'), repoName, function (err) {
          if (err) {
            errorLog("Folder creation failed: " + (err.message || err));
            return;
          }
          ls('stack', { 'complete': [], 'incomplete': [] });
          ls('key', password);
          ls('repoName', "Fastack-" + repoName);
          ls('createPage', 'add');
          window.location.replace("./createTask.html");
        });
      } else {
        ls('key', password);
        prestack.lookForStackGDrive(function (err, stackValue) {
          if (err) {
            $('#errorreponame').text("Cannot get the current stack from the folder: " + (err.message || err));
          }
          ls('stack', stackValue ? stackValue : { 'complete': [], 'incomplete': [] });
          if (ls('stack')['incomplete'].length === 0) {
            ls('createPage', 'add');
          }
        });
      }
    });
  }

  if (ls('platform') === "Github") {
    githubRepoSetup();
  } else if (ls('platform') === "Dropbox") {
    dropboxFolderSetup();
  } else if (ls('platform') === "Google") {
    gdriveFolderSetup();
  }

});

