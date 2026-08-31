const { BrowserWindow } = require('@electron/remote');
const remote = require('@electron/remote');
const {globalShortcut} = remote;
const path = require('path');
const Editor = require('@toast-ui/editor');
const electron = require('electron');
const base64 = require('base-64');
var ls = require('local-storage');
var githubFunctions = require('../helper/github_functions');
var {ipcRenderer} = electron;
var cryptoHelper = require('../helper/crypto_helper');
var conversions = require('../helper/conversions');
var stackFunctions = require('../helper/stack_functions');
var screenCapture = require('../helper/screen_capture');
var textAnalyzer = require('../helper/text_analyzer');
var window = BrowserWindow.getFocusedWindow();

function navigateTo(url) {
    document.body.classList.add('page-leaving');
    setTimeout(function () { window.location.replace(url); }, 110);
}


$(document).ready(function () {
    $('#backendPill').text(ls('platform') || 'Local');
    // Keep ordering fresh without a zero-delay loop that monopolizes the renderer.
    setInterval(function(){ stackFunctions.stackSort(); }, 30000);
    ls('currIndex', 0);
    // Recurring-task sweep: on load and every 60s. Spawns any templates whose
    // nextRunAt has passed. Safe to call repeatedly — noop if nothing due.
    try {
        var spawnedNow = stackFunctions.checkRecurring();
        if (spawnedNow) console.log('[fastack] recurring: spawned', spawnedNow, 'task(s)');
    } catch (e) { console.log('recurring check failed:', e); }
    setInterval(function () {
        try {
            var spawned = stackFunctions.checkRecurring();
            if (spawned) {
                // Re-render the board so the fresh instances show up.
                $('.s1').empty();
                $('.s1').append(stackFunctions.generateFullStackHTML(ls('currIndex') || 0));
            }
        } catch (e) {}
    }, 60_000);
    //screenCapture.startRecordingText();
    var stack = stackFunctions.generateFullStackHTML(ls('currIndex'))
    console.log(stack);
    $(".s1").append(stack);
    if (!(ls('stack') && ls('stack').incomplete && ls('stack').incomplete.length)) {
        $('.s1').html('<div class="stack-empty"><strong>No tasks yet</strong><p>Create a task to start your focus stack.</p><button id="emptyAdd" type="button">Create task</button></div>');
    }
    $(document).on('click', '#emptyAdd', function () { $('#addButton').trigger('click'); });
    $('.fastack-toolbar').on('keydown', '[role=button]', function (evt) {
        if (evt.key === 'Enter' || evt.key === ' ') { evt.preventDefault(); $(this).trigger('click'); }
    });
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
        navigateTo('../home.html');
    });
    $('#addButton').click(function(){
        ls('createPage', 'add');
        navigateTo('./createTask.html');
    });
    $("body").on('click', '.task', function() {
        var id = this.id;
        var numb = parseInt(id.match(/\d+/g));
        ls('currIndex', numb);
        // Preserve countdown state across re-render: save the interval ID and
        // whether we were clocked in.  stackFunctions.clockOut() destroys the
        // DOM element the timer updates — re-query it AFTER re-render.
        var wasClockedIn = $('#timeButton').attr('src') !== "../images/clock.png";
        var savedTimer = ls('countdownTimer') || { id: 0 };
        var oldId = savedTimer.id;
        stackFunctions.clockOut();
        clearInterval(oldId);
        var $stack = $('.s1');
        $stack.addClass('is-switching');
        $stack.find('.task').removeClass('is-selected');
        $(this).addClass('is-selected');
        setTimeout(function () {
            $stack.empty().append(stackFunctions.generateFullStackHTML(numb));
            requestAnimationFrame(function () { $stack.removeClass('is-switching'); });
            // Restart through the full clock-in path so both the countdown and
            // activity analytics follow the newly selected task.
            if (wasClockedIn) stackFunctions.clockIn(0);
        }, 90);
        // If we were clocked in, the task was moved to index 0 by
        // generateFullStackHTML.  Restore the timer so the countdown continues.
        if (wasClockedIn) {
            $('#timeButton').attr("src","../images/clocko.png");
        }
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
        navigateTo('./settings.html');
    });
    $('#reportButton').click(function(){
        navigateTo('./report.html');
    });
    $(".taskName").mouseleave(function(){
        $(this).find('.header').css("text-overflow", "ellipsis");
        $(this).find('.header').css("overflow", "hidden");
        $(this).find('.header').closest('marquee').replaceWith($(this).find('.header'));
    });

    // ---- Activity tracking: keyboard + scroll signals -----------------------
    // Keyboard counts come from the native addon (main process) via IPC.
    // Scroll (wheel) counts come from renderer-level event listeners.
    var scrollCount = 0;
    var activitySampleTimer = null;

    $(document).on('wheel', function () { scrollCount++; });

    function startActivityTracking() {
        scrollCount = 0;
        // Initialize the native addon if the user has enabled keyboard tracking.
        if (ls('keyboardTrackingEnabled')) {
            try { ipcRenderer.send('keyboard:init'); } catch (e) {}
        }
        activitySampleTimer = setInterval(function () {
            try {
                ipcRenderer.invoke('keyboard:get-counts').then(function (counts) {
                    var kb = (counts && counts.keyDown) || 0;
                    stackFunctions.recordActivity(kb, scrollCount);
                    scrollCount = 0;
                }).catch(function () { /* addon not available */ });
            } catch (e) {}
        }, 5000);
    }

    function stopActivityTracking() {
        if (activitySampleTimer) { clearInterval(activitySampleTimer); activitySampleTimer = null; }
        scrollCount = 0;
        try { ipcRenderer.send('keyboard:stop'); } catch (e) {}
    }

    // Hook clock-in/clock-out to start/stop activity tracking.
    var origClockIn = stackFunctions.clockIn;
    var origClockOut = stackFunctions.clockOut;
    stackFunctions.clockIn = function (index) {
        origClockIn(index);
        startActivityTracking();
    };
    stackFunctions.clockOut = function () {
        stopActivityTracking();
        origClockOut();
    };

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
