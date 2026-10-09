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
    if (ls('currIndex') == null) ls('currIndex', 0);
    $('#workspaceButton').on('click', function () { navigateTo('./taskLists.html'); });
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
    $(document).on('dblclick', '.task', function () {
        var index = parseInt((this.id.match(/\d+/) || ['0'])[0], 10);
        ls('currIndex', index);
        navigateTo('./taskDetail.html');
    });
    $('.global-topbar').on('keydown', 'button', function (evt) {
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
        var leave = function () { electron.ipcRenderer.invoke('window:set-size', 'standard').finally(function () { navigateTo('../home.html'); }); };
        if (stackFunctions.isClockedIn()) return stackFunctions.clockOut(leave);
        leave();
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
        var wasClockedIn = stackFunctions.isClockedIn();
        stackFunctions.clockOut();
        var $stack = $('.s1');
        $stack.addClass('is-switching');
        $stack.find('.task').removeClass('is-selected');
        $(this).addClass('is-selected');
        setTimeout(function () {
            $stack.empty().append(stackFunctions.generateFullStackHTML(numb));
            requestAnimationFrame(function () { $stack.removeClass('is-switching'); });
            // Restart through the full clock-in path so both the countdown and
            // activity analytics follow the newly selected task.
            if (wasClockedIn) stackFunctions.clockIn(numb);
        }, 90);
        // If we were clocked in, the task was moved to index 0 by
        // generateFullStackHTML.  Restore the timer so the countdown continues.
        if (wasClockedIn) {
            $('#timeButton').addClass('is-running');
        }
    });
    $('#timeButton').click(function(){
        if (!stackFunctions.isClockedIn()){
            $('#timeButton').addClass('is-running');
            var currentStack = ls('stack') || {}, selectedTask = (currentStack.incomplete || [])[parseInt(ls('currIndex'), 10) || 0];
            if (selectedTask && selectedTask.lock && selectedTask.lock.owner !== ls('fastackDeviceId')) {
                if (confirm('This task has a timer running on another platform. Transfer the timer to this device?')) { delete selectedTask.lock; delete selectedTask.timerHandoff; ls('stack', currentStack); stackFunctions.clockIn(ls('currIndex') || 0); }
            } else if (!stackFunctions.clockIn(ls('currIndex') || 0)) alert('This task is currently locked by another device.');
        } else {
            $('#timeButton').removeClass('is-running');
            stackFunctions.clockOut();
            $('#transferTimer').hide();
        }
    });
    $('#settingsButton').click(function(){
        navigateTo('./settings.html');
    });
    $('#reportButton').click(function(){
        navigateTo('./report.html');
    });
    $('#sopButton').click(function(){
        navigateTo('./sops.html');
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
    var keyboardCount = 0;
    var activitySampleTimer = null;

    $(document).on('wheel', function () { scrollCount++; });
    $(document).on('keydown', function () {
        if (ls('keyboardTrackingEnabled')) keyboardCount++;
    });

    function startActivityTracking() {
        scrollCount = 0;
        keyboardCount = 0;
        if (ls('keyboardTrackingEnabled')) {
            try { ipcRenderer.send('keyboard:init'); } catch (e) {}
        }
        activitySampleTimer = setInterval(function () {
            if (ls('keyboardTrackingEnabled')) {
                ipcRenderer.invoke('keyboard:get-counts').then(function (counts) {
                    stackFunctions.recordActivity(((counts && counts.keyDown) || 0) + keyboardCount, scrollCount);
                    keyboardCount = 0; scrollCount = 0;
                }).catch(function () {
                    stackFunctions.recordActivity(keyboardCount, scrollCount);
                    keyboardCount = 0; scrollCount = 0;
                });
            } else {
                stackFunctions.recordActivity(0, scrollCount);
                keyboardCount = 0; scrollCount = 0;
            }
        }, 5000);
    }

    function stopActivityTracking() {
        if (activitySampleTimer) { clearInterval(activitySampleTimer); activitySampleTimer = null; }
        keyboardCount = 0;
        scrollCount = 0;
        try { ipcRenderer.send('keyboard:stop'); } catch (e) {}
    }

    // Hook clock-in/clock-out to start/stop activity tracking.
    var origClockIn = stackFunctions.clockIn;
    var origClockOut = stackFunctions.clockOut;
    stackFunctions.clockIn = function (index) {
        var started = origClockIn.call(stackFunctions, index);
        if (started) startActivityTracking();
        return started;
    };
    stackFunctions.clockOut = function (callback) {
        stopActivityTracking();
        return origClockOut.call(stackFunctions, callback);
    };
    if (stackFunctions.restoreClock()) startActivityTracking();

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
