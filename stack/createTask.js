const { app, BrowserWindow } = require('@electron/remote');
const Prism = require('prismjs');
const codeSyntaxHighlight = require('@toast-ui/editor-plugin-code-syntax-highlight/dist/toastui-editor-plugin-code-syntax-highlight-all.js');
const remote = require('@electron/remote');
const {globalShortcut} = remote;
const path = require('path');
const $ = require('jquery');
const Editor = require('@toast-ui/editor');
const chart = require('@toast-ui/editor-plugin-chart');
const uml = require('@toast-ui/editor-plugin-uml');
const colorSyntax = require('@toast-ui/editor-plugin-color-syntax');
const tableMergedCell = require('@toast-ui/editor-plugin-table-merged-cell');
const electron = require('electron');
const base64 = require('base-64');
var ls = require('local-storage');
var githubFunctions = require('../helper/github_functions');
var {ipcRenderer} = remote;
var cryptoHelper = require('../helper/crypto_helper');
var stackFunctions = require('../helper/stack_functions');

var window = BrowserWindow.getFocusedWindow();


app.whenReady().then(() => {
  if(ls('stack')['incomplete'].length == 0){
    $('#goBack').hide();
  } else {
    $('#goBack').show();
  }
  $('#goBack').click(function(){
    window.location.replace('./stack.html');
  })
  if (ls('createPage') == "edit"){
    $("#createTaskTitle").text("Edit Task");
    $("#submitTask").val("Submit Changes");
  }
  var chartOptions = {      name: 'chart',
      maxWidth: 200,
      maxHeight: 300}
  var editor = new Editor({
    el: document.querySelector('#editSection'),
    previewStyle: 'vertical',
    initialEditType: 'markdown',
    height: '300px',
    toolbarItems: [],
    autofocus: false,
    events: {
      change: function(evt){
        console.log(editor.getMarkdown()); 
        tuiWindow.webContents.send('get_data_write', editor.getMarkdown());
      }
    },
    plugins: [[chart, chartOptions], [codeSyntaxHighlight, { highlighter: Prism }], colorSyntax, tableMergedCell, uml]
  });
  createTaskInput();
  function zeroPadded(val) {
    if (val >= 10)
      return val;
    else
      return '0' + val;
  }
  $("body").css("background-color", "transparent");
  $("ul li:nth-child(2)").append("<span> - 2nd!</span>");

  

  
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

  $('#tdate').bind('input propertychange', function () {
    console.log($('#tdate').val());
  });
  const { screen } = remote;
  let displays = screen.getAllDisplays();
  var width = 0;
  var totalDisplays = displays.length;
  for (var displayInd = 0; displayInd < totalDisplays; displayInd++) {
    width = width + displays[displayInd].bounds.width;
  }

  var tuiWindow = new BrowserWindow({
    width: 300, height: 500, show: false, frame: false,
    resizable: true,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    }
  });
  remote.require("@electron/remote/main").enable(tuiWindow.webContents)
  tuiWindow.loadURL(`file://${path.join(__dirname, './tui_viewer.html')}`);
  tuiWindow.setAlwaysOnTop(true);
  $('body').on('keydown', '.ProseMirror-focused', function(e) {
    if (e.which == 9) {
      e.preventDefault();
      $('#submitTask').focus();
      $('#submitTask').trigger('hover');
    }
  });
  setTimeout(function () {
    $("div").focus(function (evt) {
      evt.preventDefault();
      if ($(".ProseMirror-focused").length > 0) {
        tuiWindow.showInactive();
      }

    });
    $("div").focusout(function (evt) {
      evt.preventDefault();
      setTimeout(function () {
        if ($(".ProseMirror-focused").length == 0) {
          tuiWindow.hide();
        }
      }, 10);

    });
  }, 10);
  remote.getCurrentWindow().show();
  tuiWindow.setPosition(remote.getCurrentWindow().getPosition()[0] - 300, remote.getCurrentWindow().getPosition()[1]);
  $('#dates').on('change', function() {
    if ( $("#dates").prop("checked")) {
      $("#start").show();
      $("#comp").show();
    } else {
      $("#start").hide();
      $("#comp").hide();
    }
  });
 
  function createTaskInput(){
    var d = new Date();
    var dateString = d.getFullYear()+"-"+zeroPadded(d.getMonth() + 1)+"-"+zeroPadded(d.getDate())+"T"+zeroPadded(d.getHours())+":"+zeroPadded(d.getMinutes());
    d = new Date(dateString);
    $("#startDate").val(dateString);
    $("#compDate").val(dateString);
    $('#tname').on('input', function(){
      $("#nameError").html("<br><br>");
      if ($('#tname').val() == ""){
        $("#nameError").html("Error: Task name is required.");
      }
    });
    $('#hours, #minutes').on('input', function(){
      $("#timeError").html("<br><br>");            
      var testHours = parseInt($('#hours').val());
      var testMins = parseInt($('#minutes').val());
      if (testHours < 0 || testHours > 1000 || !/\d/.test($("#hours").val()) || testMins < 0 || testMins > 59 || !/\d/.test($("#minutes").val())){
        $("#timeError").html("Error: hours need to be between 0 and 1000 and minutes between 0 and 59");
      }
    });
    $('#priority').on('input', function(){
      $("#priorityError").html("<br><br>");
      var testPri = parseInt($('#priority').val());
      if (testPri < 1 || testPri > 100 || !/\d/.test($("#priority").val())){
        $("#priorityError").html("Error: priority needs to be between 1 and 100.");
      }
    });
    $('#startDate').on('input', function(){
      $("#startError").html("<br><br>");
      $("#compError").html("<br><br>");
      var testDate = new Date($('#startDate').val()).getTime();
      var compDate = new Date($('#compDate').val()).getTime();
      if (compDate/1000/60 < testDate/1000/60) {
        $("#compError").html("Error: task completion date cannot be earlier than the start date.");
      }
    });

    
    $('#compDate').on('input', function(){
      $("#compError").html("<br><br>");
      var testDate = new Date($('#startDate').val()).getTime();
      var compDate = new Date($('#compDate').val()).getTime();
      if (compDate/1000/60 < testDate/1000/60) {
        $("#compError").html("Error: task completion date cannot be earlier than the start date.");
      }
    });
    $('#tags').on('input', function(){
      $("#tagError").html("<br><br>");
      var test = $('#tags').val();
      if (!/^(#[a-z0-9]+\,[\s]*)*(#[a-z0-9]+[\s]*){0,1}$/gi.test(test)){
        $("#tagError").html("Error: Tags should be formatted as follows \"#tag1, #tag2, #tag3\".");
      }
    });

    $('#createNewTask').on('submit', function (evt) {
      evt.preventDefault();
      var buttonType = $("input[type=submit][clicked=true]").val();
      
      if (buttonType != "Go Back") {
      var d = new Date();
      var dateString = d.getFullYear()+"-"+zeroPadded(d.getMonth() + 1)+"-"+zeroPadded(d.getDate())+"T"+zeroPadded(d.getHours())+":"+zeroPadded(d.getMinutes());
      d = new Date(dateString);
      evt.preventDefault();
      var taskName = $("#tname").val();
      var startDate = $("#startDate").val();
      var completionDate = $("#compDate").val();
      var timeHours = parseInt($("#hours").val());
      var timeMins = parseInt($("#minutes").val());
      var priority = parseInt($("#priority").val());
      var description = $("#description").val(); 
      var tags = $("#tags").val();
      var notes = $("textarea")[1].value; 
      var complete = false;
      $("#startError").html("<br><br>"); 
      $("#compError").html("<br><br>");
      var testDate = new Date($('#startDate').val()).getTime();
      var creationDate = dateString;
      var compDate = new Date($('#compDate').val()).getTime();
      $("#error").html("<br><br>");
      var count = 0;
      if (taskName == ""){
        var nameError = "Error: Task name is required.";
        $("#nameError").html(nameError);
        count++;
      }
      if (timeHours < 0 || timeHours > 1000 || !/\d/.test($("#hours").val()) || timeMins < 0 || timeMins > 59 || !/\d/.test($("#minutes").val())){
        var timeError = "Error: hours need to be between 0 and 1000 and minutes between 0 and 59";
        $("#timeError").html(timeError);
        count++;
      }
      if (priority < 1 || priority > 100 || !/\d/.test($("#priority").val())){
        var priError = "Error: priority needs to be between 1 and 100.";
        $("#priorityError").html(priError);
        count++;
      }
      if (!/^(#[a-z0-9]+\,[\s]*)*(#[a-z0-9]+[\s]*){0,1}$/gi.test(tags)){
        var tagError = "Error: Tags should be formatted as follows \"#tag1, #tag2, #tag3\".";
        $("#tagError").html(tagError);
        count++;
      }
      if (compDate/1000/60 < testDate/1000/60) {
        $("#compError").html("Error: task completion date cannot be earlier than the start date.");
        count++;
      }
      var ignoreDates = false;
      if (!$("#dates").prop("checked")){
        ignoreDates = true;
      }
      if (count > 0){
        $("#error").html("Invalid entries were found that need to be fixed before proceeding.");
      } else {
        var stack = ls('stack')['incomplete'];
        if (ls('createPage') == "add"){
          var timeTaken = 0;
          stack.push(stackFunctions.encryptTask(stackFunctions.createTask(taskName, startDate, creationDate, completionDate, ignoreDates, timeHours.toString(), timeMins.toString(), priority.toString(), description, tags, notes, timeTaken, complete)));
        } else {
          var timeTaken = parseInt(stackFunctions.decryptItem(stack[ls('currIndex')], 'timeTaken'));
          stack[ls('currIndex')] = stackFunctions.encryptTask(stackFunctions.createTask(taskName, startDate, creationDate, completionDate, ignoreDates, timeHours.toString(), timeMins.toString(), priority.toString(), description, tags, notes, timeTaken, complete)); 
        }
        
        ls('stack', {'incomplete': stack, 'complete': ls('stack')['complete']});
        stackFunctions.stackSort();
        githubFunctions.createUpdateFile(ls('token'), ls('username'), ls('repoName'), d.getFullYear() + "/" + (d.getMonth()+1) + "/" + d.getDate(), JSON.stringify(ls('stack')));
        window.location.replace("./stack.html");
      }
      //window.location.replace("./stack.html");
    }
    });
  }
  $('#tname').focus();
});
