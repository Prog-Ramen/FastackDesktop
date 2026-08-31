var isAccelerator = require("electron-is-accelerator");
var tutorial = require('../helper/tutorial');
var remoteMod = require('@electron/remote');
var settingIpc = require('electron').ipcRenderer;
var stackFns = require('../helper/stack_functions');
// RAG lives in main to keep the popup renderer's heap tiny — `@xenova/transformers`
// + a 25MB model would OOM-crash the 300x500 popup. We drive it via IPC.

$(document).ready(function () {
    $('#showTour').on('click', function () {
        // start() navigates to the tour's starting page on its own.
        tutorial.start();
    });

    // ---------- Docs RAG ----------
    // RAG is opt-in: `ls('ragEnabled')` is the master switch, independent of
    // whether a folder has been indexed. createTask.js reads both.
    function applyRagEnabledUI(on) {
        // Dim/hide the controls when disabled to signal it's inert.
        $('#ragControls, #ragCurrent, #ragStatus').css('opacity', on ? 1 : 0.5);
        $('#ragControls input[type=button]').prop('disabled', !on);
    }
    $('#ragEnabled').prop('checked', !!ls('ragEnabled'));
    applyRagEnabledUI(!!ls('ragEnabled'));
    $('#ragEnabled').on('change', function () {
        var on = $(this).prop('checked');
        ls('ragEnabled', on);
        applyRagEnabledUI(on);
    });

    function refreshRagUI() {
        settingIpc.invoke('rag:get-meta').then(function (meta) {
            if (!meta) {
                $('#ragCurrent').text('No folder indexed yet.');
                $('#ragReindex').hide();
                $('#ragClear').hide();
                return;
            }
            $('#ragCurrent').text(meta.folder + '  ·  ' + (meta.chunks || '?') + ' chunks · ' + (meta.files || '?') + ' files');
            $('#ragReindex').show();
            $('#ragClear').show();
        });
    }
    refreshRagUI();

    // Progress events streamed from main during rag:index.
    settingIpc.removeAllListeners('rag:progress');
    settingIpc.on('rag:progress', function (_evt, p) {
        if (!p) return;
        if (p.phase === 'scanning') $('#ragStatus').text('Scanning files…');
        else if (p.phase === 'chunking') $('#ragStatus').text('Chunking · ' + (p.done || 0) + '/' + p.files + ' files');
        else if (p.phase === 'embedding') $('#ragStatus').text('Embedding · ' + (p.done || 0) + '/' + p.chunks + ' chunks');
        else if (p.phase === 'done') $('#ragStatus').text('Indexed ' + p.chunks + ' chunks from ' + p.files + ' files.');
    });

    function runIndex(folder) {
        $('#ragStatus').text('Indexing (first run downloads a small model)…');
        settingIpc.invoke('rag:index', folder).then(function (res) {
            if (!res || !res.ok) {
                $('#ragStatus').text('Error: ' + (res && res.error || 'unknown'));
                return;
            }
            refreshRagUI();
        });
    }

    $('#ragPick').on('click', function () {
        settingIpc.invoke('pick-folder', { title: 'Choose a folder to index' })
            .then(function (picked) { if (picked) runIndex(picked); })
            .catch(function (err) { $('#ragStatus').text('Dialog error: ' + (err && err.message || err)); });
    });

    $('#ragReindex').on('click', function () {
        settingIpc.invoke('rag:get-meta').then(function (meta) {
            if (meta && meta.folder) runIndex(meta.folder);
        });
    });

    $('#ragClear').on('click', function () {
        settingIpc.invoke('rag:clear').then(function () {
            $('#ragStatus').text('Index cleared.');
            refreshRagUI();
        });
    });

    // ---------- Keyboard activity tracking (optional) ----------
    // Native addon captures global keyboard events. Needs Accessibility
    // permission on macOS Sonoma+. Default is off.
    var kbTrackingEnabled = !!ls('keyboardTrackingEnabled');
    $('#keyboardTrackingEnabled').prop('checked', kbTrackingEnabled);
    $('#activityStatus').text(kbTrackingEnabled ? 'Enabled (native addon).' : 'Disabled.');
    $('#keyboardTrackingEnabled').on('change', function () {
        var on = $(this).prop('checked');
        ls('keyboardTrackingEnabled', on);
        kbTrackingEnabled = on;
        if (on) {
            // Tell main to start the addon.
            try { require('@electron/remote').ipcRenderer.send('keyboard:init'); } catch (e) {}
            $('#activityStatus').text('Enabled (native addon).');
        } else {
            try { require('@electron/remote').ipcRenderer.send('keyboard:stop'); } catch (e) {}
            $('#activityStatus').text('Disabled.');
        }
    });

    // ---------- Recurring tasks management ----------
    function summarizeSchedule(r) {
        if (!r) return '';
        var t = (r.hour != null ? (r.hour < 10 ? '0' + r.hour : r.hour) : '09') + ':' +
                (r.minute != null ? (r.minute < 10 ? '0' + r.minute : r.minute) : '00');
        if (r.frequency === 'daily')   return 'Daily at ' + t;
        if (r.frequency === 'weekly')  return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][r.dayOfWeek || 0] + ' at ' + t;
        if (r.frequency === 'monthly') return 'Day ' + (r.dayOfMonth || 1) + ' of month at ' + t;
        return t;
    }
    function refreshRecurringUI() {
        var list = stackFns.listRecurringTemplates();
        if (!list.length) {
            $('#recurringList').html('<div class="recur-empty">No recurring tasks yet. Create one via New Task &rarr; check "Recurring".</div>');
            return;
        }
        var html = '';
        list.forEach(function (tpl) {
            var next = tpl.recurrence && tpl.recurrence.nextRunAt
                ? new Date(tpl.recurrence.nextRunAt).toLocaleString().replace(/:00 /, ' ')
                : '—';
            var checked = tpl.recurrence && tpl.recurrence.enabled ? 'checked' : '';
            var esc = function (s) { return String(s || '').replace(/[<>&]/g, function (c) { return { '<':'&lt;','>':'&gt;','&':'&amp;' }[c]; }); };
            html += '<div class="recur-item" data-id="' + tpl.templateId + '">' +
                    '  <label class="switch" title="Enable / disable">' +
                    '    <input type="checkbox" class="recur-enable" ' + checked + '>' +
                    '    <span class="slider"></span>' +
                    '  </label>' +
                    '  <div class="recur-item-body">' +
                    '    <div class="recur-item-title">' + esc(tpl.taskName) + '</div>' +
                    '    <div class="recur-item-meta">' + esc(summarizeSchedule(tpl.recurrence)) + ' &middot; next ' + esc(next) + '</div>' +
                    '  </div>' +
                    '  <button type="button" class="recur-del rag-use-btn" style="background:linear-gradient(180deg,#e46767 0%,#c8484c 100%);">Delete</button>' +
                    '</div>';
        });
        $('#recurringList').html(html);
    }
    $('#recurringList').on('change', '.recur-enable', function () {
        var id = $(this).closest('.recur-item').data('id');
        stackFns.setRecurringEnabled(id, $(this).prop('checked'));
    });
    $('#recurringList').on('click', '.recur-del', function () {
        var id = $(this).closest('.recur-item').data('id');
        stackFns.removeRecurringTemplate(id);
        refreshRecurringUI();
    });
    refreshRecurringUI();
    // Show "Push to Cloud" only in Local mode.
    if (ls('platform') === 'Local') {
        $('#syncSection').show();
        function startMigration(target) {
            var repoInput = ($('#syncRepoName').val() || '').trim();
            var reRepo = /^[A-Za-z0-9_.-]+$/;
            if (!repoInput) {
                $('#syncStatus').text('Enter a cloud repo/folder name first.');
                return;
            }
            if (!reRepo.test(repoInput)) {
                $('#syncStatus').text('Name can only contain letters, digits, _ . -');
                return;
            }
            ls('migrateTarget', target);
            ls('migrateRepoName', repoInput);
            $('#syncStatus').text('Opening ' + target + ' auth...');
            window.location.replace('../home.html?migrate=' + encodeURIComponent(target));
        }
        $('#syncGithub').on('click', function () { startMigration('Github'); });
        $('#syncDropbox').on('click', function () { startMigration('Dropbox'); });
        $('#syncGoogle').on('click', function () { startMigration('Google'); });
    }
    function keyDown(shortcut) {
        return function curried_func(e) {
            var settings = ls('settings');
            if (e.key != "Escape"){

                if ($('#' + shortcut).val() == "Listening"){
                    $('#' + shortcut).val(e.key);
                    settings[shortcut] = e.key;
                } else {
                    if (!$('#' + shortcut).val().split('+').includes(e.key)){
                        var sc = $('#' + shortcut).val() + "+" + e.key;
                        if (isAccelerator(sc)){
                            $('#' + shortcut).val(sc);
                            settings[shortcut] = sc;
                        }  
                    }
                }
                ls('settings', settings);
            } else {
                window.removeEventListener('keydown', keyDown(shortcut));
            }
        }
    }
    $('#backButton').click(function(){
        window.location.replace('./stack.html');
    })
    getCreateSettings(function(err, result){
        $.each(ls('settings'), function(i, val){

            $(".tab").append(
                `<div class="taskInput">
                        <label for="tname">`+ i.match(/[A-Z][a-z]+/g).map(x => x).join(' ').trim() +`</label><br><br>
                        <input readonly id="` + i +`" type="text" name="openClose" value="`+val+`">
                    </div><br></br>`
            );
            $('#' + i).focusin(function(){
                $('#' + i).val('Listening');
                var curried = keyDown(i);
                window.addEventListener('keydown', curried);
                $('#' + i).focusout(function(){
                    if($('#' + i).val() == "Listening"){
                        $('#' + i).val(result[i]);
                    }
                    window.removeEventListener('keydown', curried);
                });
            });
            
          });
        
    });
    $('#updateSettings').on('submit', function(evt){
        evt.preventDefault();
        updateSettings(function(err, result){
            if(err){
                console.log(err);
            }
        })
        window.location.replace('./stack.html');
    });
  
});