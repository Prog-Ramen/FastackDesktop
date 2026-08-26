const { app, BrowserWindow } = require('@electron/remote');
const Prism = require('prismjs');
const codeSyntaxHighlight = require('@toast-ui/editor-plugin-code-syntax-highlight/dist/toastui-editor-plugin-code-syntax-highlight-all.js');
const remote = require('@electron/remote');
const { globalShortcut } = remote;
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
var dropboxFunctions = require('../helper/dropbox_functions');
var gdriveFunctions = require('../helper/gdrive_functions');
var localFunctions = require('../helper/local_functions');
var { ipcRenderer } = remote;
var cryptoHelper = require('../helper/crypto_helper');
var stackFunctions = require('../helper/stack_functions');
// RAG lives in main to keep the popup renderer's heap tiny — see setting.js.
var ragIpc = require('electron').ipcRenderer;

var window = BrowserWindow.getFocusedWindow();


app.whenReady().then(() => {
  if (ls('stack')['incomplete'].length == 0) {
    $('#goBack').hide();
  } else {
    $('#goBack').show();
  }
  $('#goBack').click(function () {
    window.location.replace('./stack.html');
  })
  if (ls('createPage') == "edit") {
    $("#createTaskTitle").text("Edit Task");
    $("#submitTask").val("Submit Changes");
  }
  var chartOptions = {
    name: 'chart',
    maxWidth: 200,
    maxHeight: 300
  }
  // settings.html also includes this file for shared helpers, but doesn't
  // contain an #editSection to mount the Toast UI Editor into. Bail rather
  // than throw "Cannot read properties of null (reading 'innerHTML')".
  if (!document.querySelector('#editSection')) return;
  var editor = new Editor({
    el: document.querySelector('#editSection'),
    previewStyle: 'vertical',
    initialEditType: 'markdown',
    height: '300px',
    toolbarItems: [],
    autofocus: false,
    events: {
      change: function (evt) {
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
  $('body').on('keydown', '.ProseMirror-focused', function (e) {
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
  $('#dates').on('change', function () {
    if ($("#dates").prop("checked")) {
      $("#start").show();
      $("#comp").show();
    } else {
      $("#start").hide();
      $("#comp").hide();
    }
  });

  // ---- Recurring task schedule UI ----
  function readRecurrenceFromUI() {
    var freq = $('#recurFreq').val();
    var time = ($('#recurTime').val() || '09:00').split(':');
    return {
      frequency: freq,
      hour: parseInt(time[0], 10) || 9,
      minute: parseInt(time[1], 10) || 0,
      dayOfWeek: freq === 'weekly' ? parseInt($('#recurDow').val(), 10) : undefined,
      dayOfMonth: freq === 'monthly' ? parseInt($('#recurDom').val(), 10) : undefined,
      enabled: true
    };
  }
  function refreshNextRunPreview() {
    if (!$('#recurring').prop('checked')) return;
    var r = readRecurrenceFromUI();
    var next = stackFunctions.computeNextRun(r);
    $('#recurNext').text('Next run: ' + (next ? new Date(next).toLocaleString() : '—'));
  }
  $('#recurring').on('change', function () {
    if ($(this).prop('checked')) { $('#recurringPanel').show(); refreshNextRunPreview(); }
    else { $('#recurringPanel').hide(); }
  });
  $('#recurFreq').on('change', function () {
    var v = $(this).val();
    $('#recurDowLabel').toggle(v === 'weekly');
    $('#recurDomLabel').toggle(v === 'monthly');
    refreshNextRunPreview();
  });
  $('#recurDow, #recurDom, #recurTime').on('input change', refreshNextRunPreview);

  function createTaskInput() {
    var d = new Date();
    var dateString = d.getFullYear() + "-" + zeroPadded(d.getMonth() + 1) + "-" + zeroPadded(d.getDate()) + "T" + zeroPadded(d.getHours()) + ":" + zeroPadded(d.getMinutes());
    d = new Date(dateString);
    $("#startDate").val(dateString);
    $("#compDate").val(dateString);
    $('#tname').on('input', function () {
      $("#nameError").html("<br><br>");
      if ($('#tname').val() == "") {
        $("#nameError").html("Error: Task name is required.");
      }
      scheduleRagQuery();
    });

    // ---- RAG: show top-3 related chunks as the user names a task ----
    // Opt-in: both `ls('ragEnabled')` must be true AND a folder must be indexed.
    // Users toggle it from settings; default is off so the model runs on the
    // task title alone (which produces the same quality without the crawl).
    var ragTimer = null;
    var lastRagQuery = '';
    var ragActive = false;
    ragIpc.invoke('rag:get-active').then(function (a) {
      var enabled = !!ls('ragEnabled');
      ragActive = enabled && !!a;
      if (ragActive) {
        $('#ragPanel').show();
        $('#ragResults').html('<div class="rag-empty">Start typing a task name…</div>');
      }
    });
    function scheduleRagQuery() {
      if (!ragActive) return;
      var q = ($('#tname').val() || '').trim();
      if (ragTimer) clearTimeout(ragTimer);
      if (q.length < 3) {
        $('#ragResults').html('<div class="rag-empty">Type at least 3 characters.</div>');
        return;
      }
      if (q === lastRagQuery) return;
      ragTimer = setTimeout(function () {
        lastRagQuery = q;
        ragIpc.invoke('rag:search', q, 3).then(function (res) {
          if (!res || !res.ok) { $('#ragResults').html('<div class="rag-empty">Search failed.</div>'); return; }
          var hits = res.hits || [];
          if (!hits.length) { $('#ragResults').html('<div class="rag-empty">No matches.</div>'); return; }
          var html = '';
          hits.forEach(function (h) {
            var preview = (h.chunk || '').slice(0, 240).replace(/[<>&]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]; });
            html += '<div class="rag-result"><div class="rag-result-path">' + h.path + '</div><div class="rag-result-chunk">' + preview + '</div></div>';
          });
          $('#ragResults').html(html);
        });
      }, 500);
    }

    // ---- Local LLM: generate notes and (optionally) a description summary ----
    // Two panels sharing one model + fork:
    //   - #genNotesPanel: Generate markdown notes from the task title
    //   - #genDescPanel:  Summarize existing notes into a 1-2 sentence description.
    //                     Enabled only once notes have some content, so the
    //                     description is derived from what actually got written.
    var genReady = false;
    var notesRunning = false;
    var descRunning = false;

    // Base label for the notes button changes to "Regenerate" after first run.
    var notesBaseLabel = 'Generate';

    function currentNotes() {
      try { return (editor && typeof editor.getMarkdown === 'function') ? (editor.getMarkdown() || '') : ''; }
      catch (e) { return ''; }
    }

    function refreshDescButtonEnable() {
      // Only enable "Summarize notes" once (1) model is ready and (2) notes has content.
      var canSummarize = genReady && !descRunning && currentNotes().trim().length >= 20;
      $('#genDescRun').prop('disabled', !canSummarize);
      if (!genReady) {
        // model state already covered by renderGenState — leave status alone
      } else if (!currentNotes().trim()) {
        $('#genDescStatus').text('Generate or write notes first.');
      } else if (currentNotes().trim().length < 20) {
        $('#genDescStatus').text('Notes too short — add more content, then summarize.');
      } else {
        // Only overwrite the status text if we're currently showing a "waiting" hint
        var s = $('#genDescStatus').text();
        if (/first|too short/i.test(s)) $('#genDescStatus').text('Ready to summarize.');
      }
    }

    function renderGenState(state) {
      if (!state) return;
      if (state.phase === 'ready') {
        genReady = true;
        if (!notesRunning) {
          $('#genNotesRun').prop('disabled', false).text(notesBaseLabel);
          if (!$('#genNotesOutput').text().trim()) {
            $('#genNotesStatus').text('Model ready. Enter a task name and click Generate.');
          }
        }
        refreshDescButtonEnable();
      } else if (state.phase === 'downloading') {
        genReady = false;
        $('#genNotesRun').prop('disabled', true).text('Downloading…');
        $('#genDescRun').prop('disabled', true);
        $('#genNotesStatus').text('Downloading model (' + ((state.done || 0) + 1) + '/' + (state.total || '?') + ') · ' + (state.file || ''));
      } else if (state.phase === 'loading') {
        genReady = false;
        $('#genNotesRun').prop('disabled', true).text('Loading…');
        $('#genDescRun').prop('disabled', true);
        $('#genNotesStatus').text('Loading model into memory…');
      } else if (state.phase === 'generating') {
        // Which one? whoever is running claims the "Generating…" status.
        if (notesRunning) $('#genNotesStatus').text('Generating notes…');
        if (descRunning)  $('#genDescStatus').text('Summarizing notes…');
      } else if (state.phase === 'error') {
        genReady = false;
        $('#genNotesRun').prop('disabled', true).text('Unavailable');
        $('#genDescRun').prop('disabled', true);
        $('#genNotesStatus').text('Model load failed: ' + (state.error || 'unknown'));
      } else {
        $('#genNotesRun').prop('disabled', true).text('Preparing…');
        $('#genDescRun').prop('disabled', true);
        $('#genNotesStatus').text('Preparing model…');
      }
    }

    ragIpc.invoke('rag:get-gen-state').then(renderGenState);
    ragIpc.removeAllListeners('rag:gen-progress');
    ragIpc.removeAllListeners('rag:gen-token');
    ragIpc.on('rag:gen-progress', function (_evt, p) { renderGenState(p); });

    // Streaming isn't available in transformers.js@2.17 — full text arrives at end.
    ragIpc.on('rag:gen-token', function (_evt, delta) {
      // Direct which output to append to based on who's currently running.
      var targetId = notesRunning ? 'genNotesOutput' : (descRunning ? 'genDescOutput' : null);
      if (!targetId) return;
      var el = document.getElementById(targetId);
      if (el) { el.textContent += delta; el.scrollTop = el.scrollHeight; }
    });

    // -- Notes generation --
    $('#genNotesRun').on('click', function () {
      if (notesRunning) return;
      if (!genReady) { $('#genNotesStatus').text('Model still loading — please wait.'); return; }
      var title = ($('#tname').val() || '').trim();
      if (!title) { $('#genNotesStatus').text('Enter a task name first.'); return; }
      notesRunning = true;
      $('#genNotesRun').prop('disabled', true).text('Generating…');
      $('#genNotesUse').hide();
      $('#genNotesOutput').text('');
      $('#genNotesStatus').text('Starting…');
      ragIpc.invoke('rag:generate', {
        title: title,
        mode: 'notes',
        useContext: ragActive
      }).then(function (res) {
        notesRunning = false;
        notesBaseLabel = 'Regenerate';
        $('#genNotesRun').prop('disabled', false).text(notesBaseLabel);
        if (!res || !res.ok) {
          $('#genNotesStatus').text('Error: ' + ((res && res.error) || 'unknown'));
          return;
        }
        var text = res.text || $('#genNotesOutput').text();
        $('#genNotesOutput').text(text);
        $('#genNotesStatus').text('');
        if (text.trim()) $('#genNotesUse').show();
        refreshDescButtonEnable();
      }).catch(function (err) {
        notesRunning = false;
        $('#genNotesRun').prop('disabled', false).text(notesBaseLabel);
        $('#genNotesStatus').text('Error: ' + (err && err.message || err));
      });
    });
    $('#genNotesUse').on('click', function () {
      var text = ($('#genNotesOutput').text() || '').trim();
      if (!text || !editor) return;
      try { editor.setMarkdown(text); } catch (e) { console.log('setMarkdown failed', e); }
      $('#genNotesStatus').text('Copied to Notes.');
      refreshDescButtonEnable();
    });

    // -- Description summarizer --
    $('#genDescRun').on('click', function () {
      if (descRunning) return;
      if (!genReady) { $('#genDescStatus').text('Model still loading — please wait.'); return; }
      var title = ($('#tname').val() || '').trim();
      var notes = currentNotes().trim();
      if (!title) { $('#genDescStatus').text('Enter a task name first.'); return; }
      if (!notes) { $('#genDescStatus').text('Add notes first.'); return; }
      descRunning = true;
      $('#genDescRun').prop('disabled', true).text('Summarizing…');
      $('#genDescUse').hide();
      $('#genDescOutput').text('');
      $('#genDescStatus').text('Starting…');
      ragIpc.invoke('rag:generate', {
        title: title,
        mode: 'description',
        notesBody: notes
      }).then(function (res) {
        descRunning = false;
        refreshDescButtonEnable();
        $('#genDescRun').text('Re-summarize');
        if (!res || !res.ok) {
          $('#genDescStatus').text('Error: ' + ((res && res.error) || 'unknown'));
          return;
        }
        var text = res.text || $('#genDescOutput').text();
        $('#genDescOutput').text(text);
        $('#genDescStatus').text('');
        if (text.trim()) $('#genDescUse').show();
      }).catch(function (err) {
        descRunning = false;
        refreshDescButtonEnable();
        $('#genDescStatus').text('Error: ' + (err && err.message || err));
      });
    });
    $('#genDescUse').on('click', function () {
      var text = ($('#genDescOutput').text() || '').trim();
      if (!text) return;
      $('#description').val(text);
      $('#genDescStatus').text('Copied to Description.');
    });

    // Keep the "Summarize notes" button enable state in sync with editor edits.
    // ToastUI fires an internal 'change' handler (see editor init above) which
    // logs markdown; we also poll on a short interval since ToastUI doesn't
    // expose a stable subscribe API in this version.
    setInterval(refreshDescButtonEnable, 1000);
    $('#hours, #minutes').on('input', function () {
      $("#timeError").html("<br><br>");
      var testHours = parseInt($('#hours').val());
      var testMins = parseInt($('#minutes').val());
      if (testHours < 0 || testHours > 1000 || !/\d/.test($("#hours").val()) || testMins < 0 || testMins > 59 || !/\d/.test($("#minutes").val())) {
        $("#timeError").html("Error: hours need to be between 0 and 1000 and minutes between 0 and 59");
      }
    });
    $('#priority').on('input', function () {
      $("#priorityError").html("<br><br>");
      var testPri = parseInt($('#priority').val());
      if (testPri < 1 || testPri > 100 || !/\d/.test($("#priority").val())) {
        $("#priorityError").html("Error: priority needs to be between 1 and 100.");
      }
    });
    $('#startDate').on('input', function () {
      $("#startError").html("<br><br>");
      $("#compError").html("<br><br>");
      var testDate = new Date($('#startDate').val()).getTime();
      var compDate = new Date($('#compDate').val()).getTime();
      if (compDate / 1000 / 60 < testDate / 1000 / 60) {
        $("#compError").html("Error: task completion date cannot be earlier than the start date.");
      }
    });


    $('#compDate').on('input', function () {
      $("#compError").html("<br><br>");
      var testDate = new Date($('#startDate').val()).getTime();
      var compDate = new Date($('#compDate').val()).getTime();
      if (compDate / 1000 / 60 < testDate / 1000 / 60) {
        $("#compError").html("Error: task completion date cannot be earlier than the start date.");
      }
    });
    $('#tags').on('input', function () {
      $("#tagError").html("<br><br>");
      var test = $('#tags').val();
      if (!/^(#[a-z0-9]+\,[\s]*)*(#[a-z0-9]+[\s]*){0,1}$/gi.test(test)) {
        $("#tagError").html("Error: Tags should be formatted as follows \"#tag1, #tag2, #tag3\".");
      }
    });

    $('#createNewTask').on('submit', function (evt) {
      evt.preventDefault();
      var buttonType = $("input[type=submit][clicked=true]").val();

      if (buttonType != "Go Back") {
        var d = new Date();
        var dateString = d.getFullYear() + "-" + zeroPadded(d.getMonth() + 1) + "-" + zeroPadded(d.getDate()) + "T" + zeroPadded(d.getHours()) + ":" + zeroPadded(d.getMinutes());
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
        if (taskName == "") {
          var nameError = "Error: Task name is required.";
          $("#nameError").html(nameError);
          count++;
        }
        if (timeHours < 0 || timeHours > 1000 || !/\d/.test($("#hours").val()) || timeMins < 0 || timeMins > 59 || !/\d/.test($("#minutes").val())) {
          var timeError = "Error: hours need to be between 0 and 1000 and minutes between 0 and 59";
          $("#timeError").html(timeError);
          count++;
        }
        if (priority < 1 || priority > 100 || !/\d/.test($("#priority").val())) {
          var priError = "Error: priority needs to be between 1 and 100.";
          $("#priorityError").html(priError);
          count++;
        }
        if (!/^(#[a-z0-9]+\,[\s]*)*(#[a-z0-9]+[\s]*){0,1}$/gi.test(tags)) {
          var tagError = "Error: Tags should be formatted as follows \"#tag1, #tag2, #tag3\".";
          $("#tagError").html(tagError);
          count++;
        }
        if (compDate / 1000 / 60 < testDate / 1000 / 60) {
          $("#compError").html("Error: task completion date cannot be earlier than the start date.");
          count++;
        }
        var ignoreDates = false;
        if (!$("#dates").prop("checked")) {
          ignoreDates = true;
        }
        if (count > 0) {
          $("#error").html("Invalid entries were found that need to be fixed before proceeding.");
        } else {
          var stack = ls('stack')['incomplete'];
          var isRecurring = $('#recurring').prop('checked');
          if (ls('createPage') == "add") {
            var timeTaken = 0;
            var newTask = stackFunctions.createTask(taskName, startDate, creationDate, completionDate, ignoreDates, timeHours.toString(), timeMins.toString(), priority.toString(), description, tags, notes, timeTaken, complete);
            if (isRecurring) {
              // Save as recurring template *and* spawn the first instance now.
              var recurrence = readRecurrenceFromUI();
              stackFunctions.addRecurringTemplate(newTask, recurrence, /* spawnNow */ true);
              // ls('stack') has been mutated by addRecurringTemplate; refresh.
              stack = ls('stack')['incomplete'];
            } else {
              stack.push(newTask);
            }
          } else {
            var timeTaken = parseInt(stack[ls('currIndex')].timeTaken, 10) || 0;
            stack[ls('currIndex')] = stackFunctions.createTask(taskName, startDate, creationDate, completionDate, ignoreDates, timeHours.toString(), timeMins.toString(), priority.toString(), description, tags, notes, timeTaken, complete);
          }

          ls('stack', { 'incomplete': stack, 'complete': ls('stack')['complete'], 'templates': ls('stack')['templates'] || [] });
          stackFunctions.stackSort();
          var datePath = d.getFullYear() + "/" + (d.getMonth() + 1) + "/" + d.getDate();
          var stackJson = JSON.stringify(ls('stack'));
          var onWrite = function (err) { if (err) { console.log(err); } };
          if (ls('platform') === "Github") {
            githubFunctions.createUpdateFile(ls('token'), ls('username'), ls('repoName'), datePath, stackJson, onWrite);
          } else if (ls('platform') === "Dropbox") {
            dropboxFunctions.createUpdateFile(ls('token'), ls('repoName') + "/" + datePath, stackJson, onWrite);
          } else if (ls('platform') === "Google") {
            gdriveFunctions.createUpdateFile(ls('token'), ls('repoName') + "/" + datePath, stackJson, onWrite);
          } else if (ls('platform') === "Local") {
            localFunctions.createUpdateFile("", ls('repoName') + "/" + datePath, stackJson, onWrite);
          }
          window.location.replace("./stack.html");
        }
      }
    });
  }
  $('#tname').focus();
});
