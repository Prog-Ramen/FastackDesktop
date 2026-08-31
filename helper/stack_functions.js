const base64 = require('base-64');
var ls = require('local-storage');
var githubFunctions = require('./github_functions');
var dropboxFunctions = require('./dropbox_functions');
var gdriveFunctions = require('./gdrive_functions');
var localFunctions = require('./local_functions');
var activityTracker = require('./activity_tracker');
ls('countdownTimer', {'id': 0});

// Persist the current in-memory stack (ls('stack')) to whichever backend is active,
// under today's <year>/<month>/<day> path. Called after any stack mutation that isn't
// createTask (pop, clock-out) so restarts see the latest state.
exports.persistStack = function (callback) {
  var cb = callback || function () {};
  var d = new Date();
  var datePath = d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate();
  var stackJson = JSON.stringify(ls('stack'));
  var platform = ls('platform');
  if (platform === 'Github') {
    githubFunctions.createUpdateFile(ls('token'), ls('username'), ls('repoName'), datePath, stackJson, cb);
  } else if (platform === 'Dropbox') {
    dropboxFunctions.createUpdateFile(ls('token'), ls('repoName') + '/' + datePath, stackJson, cb);
  } else if (platform === 'Google') {
    gdriveFunctions.createUpdateFile(ls('token'), ls('repoName') + '/' + datePath, stackJson, cb);
  } else if (platform === 'Local') {
    localFunctions.createUpdateFile('', ls('repoName') + '/' + datePath, stackJson, cb);
  } else {
    return cb(null);
  }
};

exports.createTask = function(taskName, startDate, creationDate, completionDate, ignoreDates, timeHours, timeMins, priority, description, tags, notes, timeTaken, complete) {
    var taskObject = {
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
    ls('stack', {'incomplete': stack, 'complete': ls('stack')['complete']});
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
    return `<div id="t${index}" class="task taskName" style="background: ${color}${translate}; opacity: ${index != current?1/(Math.abs(current-index)+1):0.98}">` +
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

exports.countdown = function(index){
    var stackNow = ls('stack');
    var task = stackNow && stackNow['incomplete'] && stackNow['incomplete'][index];
    if (!task) return 0; // nothing to time; caller stores 0 and skips
    var durationMs = (parseInt(task.timeHours) || 0) * (1000 * 60 * 60) + (parseInt(task.timeMins) || 0) * (1000 * 60);
    var alreadyTakenMs = parseInt(task.timeTaken) || 0;
    var countUp = durationMs <= 0;
    var sessionStart = Date.now() - alreadyTakenMs;
    var dt = sessionStart + durationMs;

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
    var x = setInterval(function () {
        try {
            var s = ls('stack');
            var incomplete = s && s['incomplete'];
            if (!incomplete || !incomplete[index]) return;
            var now = Date.now();
            var elapsed = now - sessionStart;
            incomplete[index].timeTaken = elapsed;
            ls('stack', { 'incomplete': incomplete, 'complete': s['complete'] || [] });

            var statusEl = document.getElementById("status");
            if (!statusEl) return; // e.g. we're on createTask.html — nothing to render into
            var display = countUp ? elapsed : (dt - now);
            statusEl.innerHTML = '<h3 id="inside">' + render(display) + '</h3>';
            var inside = document.getElementById("inside");
            if (inside) inside.classList.add("blink_me");
        } catch (e) { /* keep the timer alive */ }
    }, 1000);
    return x;
}

exports.clockIn = function(index){
    var stack = ls('stack');
    var task = stack && stack['incomplete'] && stack['incomplete'][index];
    if (!task) return; // nothing to clock in on
    var timer = ls('countdownTimer') || { id: 0 };
    if (timer.id == 0){
        var id = 0;
        try { id = this.countdown(index) || 0; } catch (e) { id = 0; }
        ls('countdownTimer', { id: id });
        try { activityTracker.start(task.taskName); } catch (e) { /* tracker must not block clock-in */ }
    }
}

exports.clockOut = function(){
    clearInterval(ls('countdownTimer')['id']);
    var top = ls('stack')['incomplete'][0];
    if (top) {
        document.getElementById("status").innerHTML = '<h2>' + this.generateStatus(top) + '</h2>';
    }
    ls('countdownTimer', {'id': 0});
    // Persist the tracked time so it survives a restart.
    this.persistStack();
    try { activityTracker.stop(); } catch (e) { /* noop */ }
}

/**
 * Pass keyboard/mouse activity signals to the tracker.
 * Called by the renderer (stack.js) on each sample interval.
 */
exports.recordActivity = function (keyboardCount, scrollCount) {
    try { activityTracker.recordActivity(keyboardCount, scrollCount); } catch (e) { /* noop */ }
};