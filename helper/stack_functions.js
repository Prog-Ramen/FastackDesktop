const base64 = require('base-64');
var ls = require('local-storage');
var githubFunctions = require('./github_functions');
var dropboxFunctions = require('./dropbox_functions');
var gdriveFunctions = require('./gdrive_functions');
var localFunctions = require('./local_functions');
var activityTracker = require('./activity_tracker');
var profileCache = require('./profile_cache');
var taskMerge = require('./task_merge');
var taskLock = require('./task_lock');
// Electron returns Node Timeout objects, which cannot be serialized safely.
var countdownTimerHandle = null;

function taskId(task) {
    if (!task.taskId) task.taskId = 'task_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
    return task.taskId;
}
function deviceId() {
    var id = ls('fastackDeviceId');
    if (!id) { id = 'device_' + Math.random().toString(36).slice(2); ls('fastackDeviceId', id); }
    return id;
}

function findTaskIndexById(stack, id) {
    var tasks = stack && stack.incomplete || [];
    for (var i = 0; i < tasks.length; i++) if (taskId(tasks[i]) === id) return i;
    return -1;
}

// Persist the current in-memory stack (ls('stack')) to whichever backend is active,
// under today's <year>/<month>/<day> path. Called after any stack mutation that isn't
// createTask (pop, clock-out) so restarts see the latest state.
exports.persistStack = function (callback) {
  var cb = callback || function () {};
  var d = new Date();
  var datePath = d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate();
  var stackJson = JSON.stringify(ls('stack'));
  var platform = String(ls('platform') || '').toLowerCase();
  profileCache.saveActive(ls('stack'));
  // Always maintain the local snapshot, even while a cloud provider is active.
  // This makes offline recovery and provider-to-provider merging reliable.
  localFunctions.createUpdateFile('', 'local/' + datePath, stackJson, function (localErr) {
    if (localErr) return cb(localErr);
    if (platform === 'github') return githubFunctions.createUpdateFile(ls('token'), ls('username'), ls('repoName'), datePath, stackJson, cb);
    if (platform === 'dropbox') return dropboxFunctions.createUpdateFile(ls('token'), ls('repoName') + '/' + datePath, stackJson, cb);
    if (platform === 'google') return gdriveFunctions.createUpdateFile(ls('token'), ls('repoName') + '/' + datePath, stackJson, cb);
    if (platform === 'local') return localFunctions.createUpdateFile('', ls('repoName') + '/' + datePath, stackJson, cb);
    return cb(null);
  });
};

exports.createTask = function(taskName, startDate, creationDate, completionDate, ignoreDates, timeHours, timeMins, priority, description, tags, notes, timeTaken, complete) {
    var now = new Date().toISOString();
    var taskObject = {
        taskId: 'task_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9),
        taskName: taskName,
        startDate: startDate,
        creationDate: creationDate,
        completionDate: completionDate,
        ignoreDates: ignoreDates,
        timeHours: timeHours,
        timeMins: timeMins,
        priority: priority,
        description: description,
        tags: tags,
        notes: notes,
        timeTaken: timeTaken,
        complete: complete
        ,updatedAt: now
        ,sourceDevice: deviceId()
        ,fieldRevisions: { description: { updatedAt: now, source: deviceId(), value: description || '' } }
    }
    return taskObject;
}

// -------------------- recurring tasks --------------------
//
// Templates persist in ls('stack').templates. Each has all the createTask
// fields plus a `recurrence` object. When app opens (and periodically),
// checkRecurring() spawns fresh instances into the incomplete stack for any
// template whose nextRunAt has passed.

function zeroPad2(n) { return n < 10 ? '0' + n : '' + n; }

exports.computeNextRun = function (recurrence, fromMs) {
    if (!recurrence) return null;
    var now = fromMs != null ? fromMs : Date.now();
    var d = new Date(now);
    d.setSeconds(0, 0);
    var hour = recurrence.hour != null ? recurrence.hour : 9;
    var minute = recurrence.minute != null ? recurrence.minute : 0;
    if (recurrence.frequency === 'daily') {
        d.setHours(hour, minute, 0, 0);
        if (d.getTime() <= now) d.setDate(d.getDate() + 1);
        return d.getTime();
    } else if (recurrence.frequency === 'weekly') {
        var target = recurrence.dayOfWeek != null ? recurrence.dayOfWeek : 1;
        d.setHours(hour, minute, 0, 0);
        var diff = (target - d.getDay() + 7) % 7;
        if (diff === 0 && d.getTime() <= now) diff = 7;
        d.setDate(d.getDate() + diff);
        return d.getTime();
    } else if (recurrence.frequency === 'monthly') {
        var dom = recurrence.dayOfMonth || 1;
        d.setDate(dom);
        d.setHours(hour, minute, 0, 0);
        if (d.getTime() <= now) d.setMonth(d.getMonth() + 1);
        return d.getTime();
    }
    return null;
};

// Save `taskFields` as a recurring template. Optionally also spawn an initial
// instance right now (so the user doesn't have to wait until the first firing
// to see anything on the board).
exports.addRecurringTemplate = function (taskFields, recurrence, spawnNow) {
    var stack = ls('stack') || { incomplete: [], complete: [] };
    var templates = stack.templates || [];
    var tpl = Object.assign({}, taskFields, {
        recurrence: Object.assign({
            enabled: true,
            lastSpawnAt: 0
        }, recurrence),
        templateId: 't_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8)
    });
    if (!tpl.recurrence.nextRunAt) tpl.recurrence.nextRunAt = exports.computeNextRun(tpl.recurrence);
    templates.push(tpl);
    stack.templates = templates;
    if (spawnNow) {
        var instance = exports.createTask(
            tpl.taskName, tpl.startDate, tpl.creationDate, tpl.completionDate,
            tpl.ignoreDates, tpl.timeHours, tpl.timeMins, tpl.priority,
            tpl.description, tpl.tags, tpl.notes, 0, false
        );
        instance.recurringTemplateId = tpl.templateId;
        stack.incomplete = (stack.incomplete || []).concat([instance]);
        tpl.recurrence.lastSpawnAt = Date.now();
    }
    ls('stack', stack);
    return tpl;
};

// Sweep templates; for any whose nextRunAt has passed, clone into incomplete,
// then advance nextRunAt. Returns the number spawned so callers can decide
// whether to persist to the cloud backend.
exports.checkRecurring = function () {
    var stack = ls('stack');
    if (!stack) return 0;
    var templates = stack.templates || [];
    if (!templates.length) return 0;
    var incomplete = stack.incomplete || [];
    var now = Date.now();
    var spawned = 0;
    var d = new Date(now);
    var creationDate = d.getFullYear() + '-' + zeroPad2(d.getMonth() + 1) + '-' +
                       zeroPad2(d.getDate()) + 'T' + zeroPad2(d.getHours()) + ':' + zeroPad2(d.getMinutes());
    templates.forEach(function (tpl) {
        if (!tpl.recurrence || !tpl.recurrence.enabled) return;
        var nextAt = tpl.recurrence.nextRunAt;
        if (!nextAt) {
            tpl.recurrence.nextRunAt = exports.computeNextRun(tpl.recurrence, now);
            return;
        }
        // Guard: don't double-spawn if a fresh instance from the same template
        // is already sitting in the incomplete stack. Users can complete it
        // to "consume" this cycle; the next cycle will spawn as scheduled.
        var alreadyOpen = incomplete.some(function (t) { return t.recurringTemplateId === tpl.templateId; });
        if (now >= nextAt && !alreadyOpen) {
            var instance = exports.createTask(
                tpl.taskName, tpl.startDate, creationDate, tpl.completionDate,
                tpl.ignoreDates, tpl.timeHours, tpl.timeMins, tpl.priority,
                tpl.description, tpl.tags, tpl.notes, 0, false
            );
            instance.recurringTemplateId = tpl.templateId;
            incomplete.push(instance);
            spawned++;
            tpl.recurrence.lastSpawnAt = now;
        }
        // Always advance next run so we don't spin on a template whose
        // instance is still open (nextRunAt would otherwise stay <= now).
        if (now >= nextAt) {
            tpl.recurrence.nextRunAt = exports.computeNextRun(tpl.recurrence, now);
        }
    });
    if (spawned) {
        stack.incomplete = incomplete;
        stack.templates = templates;
        ls('stack', stack);
        try { exports.stackSort(); } catch (e) {}
        try { exports.persistStack(); } catch (e) {}
    } else {
        // No new instances but nextRunAt may have advanced — persist locally.
        stack.templates = templates;
        ls('stack', stack);
    }
    return spawned;
};

exports.listRecurringTemplates = function () {
    var stack = ls('stack');
    return (stack && stack.templates) || [];
};

exports.setRecurringEnabled = function (templateId, enabled) {
    var stack = ls('stack');
    if (!stack || !stack.templates) return;
    stack.templates.forEach(function (tpl) {
        if (tpl.templateId === templateId) tpl.recurrence.enabled = !!enabled;
    });
    ls('stack', stack);
};

exports.removeRecurringTemplate = function (templateId) {
    var stack = ls('stack');
    if (!stack || !stack.templates) return;
    stack.templates = stack.templates.filter(function (tpl) { return tpl.templateId !== templateId; });
    ls('stack', stack);
};

exports.stackSort = function(){
    var stack = ls('stack')['incomplete'];
    stack.sort(function(a,b){
        return (b.ignoreDates - a.ignoreDates) || (!b.ignoreDates && !a.ignoreDates && (new Date(a.startDate) - new Date(b.startDate))) || b.priority - a.priority ||  (!b.ignoreDates && !a.ignoreDates && (new Date(a.completionDate) - new Date(b.completionDate))) ;
    })
    var stack_length = stack.length;
    var overdue = []
    var first = 0;
    var count = 0;
    for (var i = 0; i < stack_length; i++){
    var task = stack[i];
    if (new Date(task.completionDate) < new Date() && !task.ignoreDates){
        if (count == 0){
        first = i;
        }
        overdue.push(stack[i]);
        count++;
    }
    }
    overdue.sort(function(a,b){
        return b.priority - a.priority;
    });
    stack.splice(first, count);
    stack = overdue.concat(stack);
    ls('stack', {'incomplete': stack, 'complete': ls('stack')['complete'], 'templates': ls('stack')['templates'] || []});
    return stack;
}

exports.generateTranslate = function(stack_length, index, current) {
    var height = 85/(stack_length-1);
    var overhead = -40/(stack_length-1);
    if (stack_length == 1){
        height = 100;
    }
    if (stack_length > 6){
        height = 85/5;
        overhead = -40/5;
    }
    var translate = index>0?"transform: translateY(" + overhead*index + "vh); ":"";
    var actualH = index!=current?"height: " + height + "%;":"height: 50%;";
    translate = translate+actualH;
    translate = translate + ` z-index: ${index<current?(stack_length+index-current):(stack_length-index+current)};`;
    overhead = overhead + 2/(stack_length-1);
    return [translate, overhead];
}

exports.getRandomTheme = function() {
    let utf8Encode = new TextEncoder();
    var bytesArray = utf8Encode.encode('{"input": [[0,168,157],[100,129,16],"N",[0,0,0],"N"], "model":"ui"}');
    $.ajax({
        url: 'http://colormind.io/api/',
        type: 'POST',
        contentType: 'application/octet-stream',  
        data: bytesArray,
        async: false,
        processData: false,
        success: function(result){
            
        }, error: function(error){
            console.log(error);
        }
        });
}

exports.isToday = function(someDate) {
    var today = new Date();
    return someDate.getDate() == today.getDate() &&
      someDate.getMonth() == today.getMonth() &&
      someDate.getFullYear() == today.getFullYear()
  }


exports.previousDate = function(someDate) {
    var today = new Date();
    return someDate.getDate() < today.getDate();
}

exports.futureDate = function(someDate) {
    var today = new Date();
    return someDate.getDate() > today.getDate();
}
 
//+ </h2>':'<h2>'+decrypted['taskName']+'
//<th><h2>${decrypted['taskName'].length>12?decrypted['taskName'].slice(0,12)+"...":decrypted['taskName']}</h2></th>
exports.generateTaskHTML = function(index, translate, decrypted,overhead, status,current) {
    // Fastack task-state palette (see docs/palette or README).
    // in-progress = actively working, overdue = past due, upcoming/todo = queued.
    var color = "";
    if (status == "overdue"){
        color = "#d15656;";        // dust rose
    } else if (status == "active"){
        color = "#3ea680;";        // sage green
    } else {
        color = "#6b7383;";        // slate (todo/upcoming)
    }
    // Keep depth styling subtle and readable on the transparent canvas.
    var depthOpacity = index != current ? Math.max(0.90, 1 / (Math.abs(current - index) + 1)) : 0.99;
    return `<div id="t${index}" class="task taskName" style="background: ${color}${translate}; opacity: ${depthOpacity}">` +
            `<table align="center" ${index>current?"style='position:absolute; top: "+ -overhead*1.1+"vh;'":""}>
            <tr>
              <th><h2 class="header">${decrypted['taskName']}</h2></th>
              <th id="status" style="text-align:right;"><h2>${status}</h2></th>            
            </tr>
            ${!decrypted['ignoreDates']?
            `<tr>
              <th>From: </th>
              <td>${new Date(decrypted['startDate']).toLocaleString().replace(/:00 |,/gi, '')}</td>
            </tr>
            <tr>
              <th>To: </th>
              <td>${new Date(decrypted['completionDate']).toLocaleString().replace(/:00 |,/gi, '')}</td>
            </tr>`:``
            }
            <tr>
              <th>Duration: </th>
              <td>${decrypted['timeHours']} hours ${decrypted['timeMins']} mins<br></td>
            </tr>
            <tr>
              <th>Priority: </th>
              <td>${decrypted['priority']}<br></td>
            </tr>
            <tr>
              <th>Tags: </th>
              <td>${decrypted['tags']}<br></td>
            </tr>
            <tr>
              <th>Created At: </th>
              <td>${new Date(decrypted['creationDate']).toLocaleString().replace(/:00 |,/gi, '')}<br></td>
            </tr>
            </table>
            </div>`;
}

exports.generateFullStackHTML = function(current){
    var return_val = "";
    var stack_length = ls('stack')['incomplete'].length;
    for (var index = 0; index < stack_length; index++){
        var result = this.generateTranslate(stack_length, index, current);
        var translate = result[0];
        var overhead = result[1];
        // Since we deal with Firefox and Chrome only
        var decrypted = ls('stack')['incomplete'][index];
        var status = this.generateStatus(decrypted);
        return_val += this.generateTaskHTML(index, translate, decrypted, overhead, status, current);
    }
    return return_val;
}

exports.generateStatus = function(decrypted_task){
    var status = "";
    if (!decrypted_task.ignoreDates){
        var current = new Date();
        var start = new Date(decrypted_task.startDate);
        var comp = new Date(decrypted_task.completionDate);
        
        if (current >= start && current <= comp) {
            status = "active";
        } else if (current < start) {
            status = "upcoming";
        } else if (current > comp) {
            status = "overdue";
        }
    } else {
        status = "active";
    }
    return status;
}

exports.countdown = function(index, clockState){
    var stackNow = ls('stack');
    var task = stackNow && stackNow['incomplete'] && stackNow['incomplete'][index];
    if (!task) return 0; // nothing to time; caller stores 0 and skips
    var id = taskId(task);
    var durationMs = (parseInt(task.timeHours) || 0) * (1000 * 60 * 60) + (parseInt(task.timeMins) || 0) * (1000 * 60);
    var state = clockState || { taskId: id, startedAt: Date.now(), baseTimeTaken: parseInt(task.timeTaken) || 0 };
    var countUp = durationMs <= 0;

    var render = function (ms) {
        var neg = ms < 0;
        var abs = Math.abs(ms);
        var hours = Math.floor(abs / (1000 * 60 * 60));
        var minutes = Math.floor((abs % (1000 * 60 * 60)) / (1000 * 60));
        var seconds = Math.floor((abs % (1000 * 60)) / 1000);
        return (neg ? '-' : '') + hours + "h " + minutes + "m " + seconds + "s ";
    };

    // A single unhandled error inside setInterval bubbles as an uncaught error
    // on every subsequent tick — enough to make the popup feel dead. Wrap the
    // whole body and no-op when the DOM element isn't on this page.
    var tick = function () {
        try {
            var s = ls('stack');
            var incomplete = s && s['incomplete'];
            var liveIndex = findTaskIndexById(s, id);
            if (!incomplete || liveIndex < 0) return;
            var now = Date.now();
            var elapsed = (parseInt(state.baseTimeTaken) || 0) + Math.max(0, now - state.startedAt);
            incomplete[liveIndex].timeTaken = elapsed;
            ls('stack', { 'incomplete': incomplete, 'complete': s['complete'] || [], 'templates': s['templates'] || [] });

            var taskEl = document.getElementById('t' + liveIndex);
            var statusEl = taskEl && taskEl.querySelector('#status');
            if (!statusEl) return; // e.g. we're on createTask.html — nothing to render into
            var display = countUp ? elapsed : (durationMs - elapsed);
            statusEl.innerHTML = '<h3 id="inside">' + render(display) + '</h3>';
            var inside = document.getElementById("inside");
            if (inside) inside.classList.add("blink_me");
        } catch (e) { console.error('[fastack] timer tick failed:', e); }
    };
    tick();
    var x = setInterval(tick, 1000);
    return x;
}

exports.clockIn = function(index){
    var stack = ls('stack');
    var task = stack && stack['incomplete'] && stack['incomplete'][index];
    if (!task) return false; // nothing to clock in on
    var id = taskId(task);
    var lockResult = taskLock.acquire(task, 'timer');
    if (!lockResult.ok) return false;
    var state = ls('countdownTimer') || { active: false };
    if (state.active && state.taskId !== id) exports.clockOut();
    if (!countdownTimerHandle){
        if (task.timerHandoff) { delete task.timerHandoff; ls('stack', stack); }
        state = state.active && state.taskId === id ? state : {
            active: true, taskId: id, startedAt: Date.now(), baseTimeTaken: parseInt(task.timeTaken) || 0
        };
        ls('stack', stack);
        state.sessionId = state.sessionId || ('session_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2));
        state.sourceDevice = deviceId();
        ls('countdownTimer', state);
        try { exports.persistStack(); } catch (e) {}
        try { countdownTimerHandle = exports.countdown(index, state) || null; } catch (e) { console.error('[fastack] clock-in failed:', e); countdownTimerHandle = null; }
        if (!countdownTimerHandle) ls('countdownTimer', { active: false });
        try { activityTracker.start(task.taskName); } catch (e) { /* tracker must not block clock-in */ }
    }
    var clockButton = typeof document !== 'undefined' && document.getElementById('timeButton');
    if (clockButton) clockButton.setAttribute('src', '../images/clocko.png');
    return true;
}

exports.clockOut = function(callback){
    var priorState = ls('countdownTimer') || {};
    if (countdownTimerHandle) clearInterval(countdownTimerHandle);
    countdownTimerHandle = null;
    var stack = ls('stack') || { incomplete: [] };
    var priorIndex = priorState.taskId ? findTaskIndexById(stack, priorState.taskId) : -1;
    var priorTask = priorIndex >= 0 ? stack.incomplete[priorIndex] : null;
    if (priorTask && priorState.startedAt) {
        var duration = Math.max(0, Date.now() - priorState.startedAt);
        priorTask.timeSessions = priorTask.timeSessions || [];
        if (!priorTask.timeSessions.some(function (s) { return s.sessionId === priorState.sessionId; })) priorTask.timeSessions.push({ sessionId: priorState.sessionId || ('session_' + Date.now()), startedAt: priorState.startedAt, stoppedAt: Date.now(), durationMs: duration, sourceDevice: priorState.sourceDevice || deviceId() });
        priorTask.timeTaken = (parseInt(priorState.baseTimeTaken) || 0) + duration;
        ls('stack', stack);
        taskLock.release(priorTask);
    }
    var priorTaskEl = typeof document !== 'undefined' && priorIndex >= 0 && document.getElementById('t' + priorIndex);
    var priorStatus = priorTaskEl && priorTaskEl.querySelector('#status');
    if (priorStatus && priorTask) priorStatus.innerHTML = '<h2>' + exports.generateStatus(priorTask) + '</h2>';
    var selected = stack['incomplete'][ls('currIndex') || 0];
    if (selected) {
        var status = typeof document !== 'undefined' && document.getElementById("status");
        if (status) status.innerHTML = '<h2>' + exports.generateStatus(selected) + '</h2>';
    }
    var clockButton = typeof document !== 'undefined' && document.getElementById('timeButton');
    if (clockButton) clockButton.setAttribute('src', '../images/clock.png');
    ls('countdownTimer', { active: false });
    // Persist the tracked time so it survives a restart.
    exports.persistStack(callback || function () {});
    try { activityTracker.stop(); } catch (e) { /* noop */ }
}

exports.transferTimer = function (callback) {
    var state = ls('countdownTimer') || {}, stack = ls('stack') || { incomplete: [] };
    var index = state.taskId ? findTaskIndexById(stack, state.taskId) : -1, task = index >= 0 ? stack.incomplete[index] : null;
    if (!task || !state.active) return false;
    var now = Date.now(), elapsed = Math.max(0, now - (state.startedAt || now));
    task.timeTaken = (parseInt(state.baseTimeTaken) || 0) + elapsed; task.timeSessions = task.timeSessions || [];
    if (!state.sessionId || !task.timeSessions.some(function (s) { return s.sessionId === state.sessionId; })) task.timeSessions.push({ sessionId: state.sessionId || ('session_' + now), startedAt: state.startedAt, stoppedAt: now, durationMs: elapsed, sourceDevice: state.sourceDevice });
    task.timerHandoff = { taskId: task.taskId, accumulatedMs: task.timeTaken, fromDevice: state.sourceDevice, transferredAt: new Date(now).toISOString() };
    if (countdownTimerHandle) clearInterval(countdownTimerHandle); countdownTimerHandle = null; ls('countdownTimer', { active: false }); taskLock.release(task); ls('stack', stack);
    try { activityTracker.stop(); } catch (e) {} exports.persistStack(callback || function () {}); return true;
};

exports.isClockedIn = function () {
    var state = ls('countdownTimer') || {};
    return !!state.active;
};

exports.restoreClock = function () {
    var state = ls('countdownTimer') || {};
    if (!state.active || !state.taskId) return false;
    var stack = ls('stack');
    var index = findTaskIndexById(stack, state.taskId);
    if (index < 0) { ls('countdownTimer', { active: false }); return false; }
    if (!countdownTimerHandle) countdownTimerHandle = exports.countdown(index, state) || null;
    try { activityTracker.start(stack.incomplete[index].taskName); } catch (e) {}
    var clockButton = typeof document !== 'undefined' && document.getElementById('timeButton');
    if (clockButton) clockButton.setAttribute('src', '../images/clocko.png');
    return !!countdownTimerHandle;
};

/**
 * Pass keyboard/mouse activity signals to the tracker.
 * Called by the renderer (stack.js) on each sample interval.
 */
exports.recordActivity = function (keyboardCount, scrollCount) {
    try { activityTracker.recordActivity(keyboardCount, scrollCount); } catch (e) { /* noop */ }
};
