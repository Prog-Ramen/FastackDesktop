const { BrowserWindow } = require('@electron/remote');
const remote = require('@electron/remote');
const {globalShortcut} = remote;
const path = require('path');
const Editor = require('@toast-ui/editor');
const electron = require('electron');
const base64 = require('base-64');
var ls = require('local-storage');
var githubFunctions = require('../helper/github_functions');
var {ipcRenderer} = remote;
var cryptoHelper = require('../helper/crypto_helper');
var conversions = require('../helper/conversions');
var stackFunctions = require('../helper/stack_functions');
var screenCapture = require('../helper/screen_capture');
var textAnalyzer = require('../helper/text_analyzer');
var window = BrowserWindow.getFocusedWindow();


$(document).ready(function () {
    setInterval(function(){ stackFunctions.stackSort()});
    ls('currIndex', 0);
    //screenCapture.startRecordingText();
    var stack = stackFunctions.generateFullStackHTML(ls('currIndex'))
    console.log(stack);
    $(".s1").append(stack);
    $(".taskName").mouseover(function(){
        var $c = $(this).find('.header')
           .clone()
           .css({display: 'inline', width: 'auto', visibility: 'hidden'})
           .appendTo('body');
        if (!$(this).find('.header').parent().is('marquee') && $c.width() > $(this).find('.header').width()){
            $(this).find('.header').css("text-overflow", "initial");
            $(this).find('.header').css("overflow", "initial");
            $(this).find('.header').wrap('<marquee scrollamount="5" behavior="scroll" direction="left"></marquee>');
        }
        $c.remove();
    });
    $('#logout').click(function(){
        window.location.replace('../home.html');
    });
    $('#addButton').click(function(){
        ls('createPage', 'add');
        window.location.replace('./createTask.html');
    });
    $("body").on('click', '.task', function() {
        var id = this.id;
        var numb = parseInt(id.match(/\d+/g));
        ls('currIndex', numb);
        $('.s1').empty();
        $(".s1").append(stackFunctions.generateFullStackHTML(numb));
    });
    $('#timeButton').click(function(){
        if ($('#timeButton').attr('src') == "../images/clock.png"){
            $('#timeButton').attr("src","../images/clocko.png");
            stackFunctions.clockIn(0);
        } else {
            $('#timeButton').attr("src","../images/clock.png");
            stackFunctions.clockOut();
        }
    });
    $('#settingsButton').click(function(){
        window.location.replace('./settings.html');  
    });
    $(".taskName").mouseleave(function(){
        $(this).find('.header').css("text-overflow", "ellipsis");
        $(this).find('.header').css("overflow", "hidden");
        $(this).find('.header').closest('marquee').replaceWith($(this).find('.header'));
    });

    $(".task").each(function(){
        var taskTop = $(this).offset().top;
        var taskH = $(this).height();
        $(this).find('tr').each(function(){
            var trTop = $(this).offset().top;
            var trH = $(this).height();
	    console.log(trTop);
	    console.log(trH);
	    console.log(taskH);
	    console.log(taskTop);
            if ($(this).index() != 0 && ((taskTop + taskH) - (trTop + trH)) < 0) {
              //$(this).css('display', 'none');
            }
       });
    });
});
