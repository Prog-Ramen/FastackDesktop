// Deterministic productivity report.
//
// Reads all activity sessions from the active backend, aggregates per range
// (today / week / all), and renders KPIs + Chart.js pies/bars.
// No model calls, no external requests. Pure rollup.
//
// Activity samples use idle detection (powerMonitor, zero permissions) and
// behavioral categorization when the popup has focus:
//   idle   → system idle 30s+
//   write  → dominant typing (keyboard >> scroll)
//   read   → dominant scrolling (scroll >> keyboard)
//   browse → mouse-driven, low keyboard
//   other  → active but unclear pattern

var ls = require('local-storage');
var localFunctions = require('../helper/local_functions');

var SAMPLE_MS = 5000;              // Must match activity_tracker.SAMPLE_MS
var CATEGORY_COLORS = {
  write:  '#e0a760',
  read:   '#c48ac0',
  browse: '#5b9cd6',
  idle:   '#6b7383',
  other:  '#8b96a8'
};

function loadSessions() {
  if (ls('platform') !== 'Local') return null;
  try { return localFunctions.readAllActivity(ls('repoName') || 'local'); }
  catch (e) { return []; }
}

function dateKey(d) {
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}

function filterRange(rows, range) {
  var today = new Date();
  var todayKey = dateKey(today);
  if (range === 'today') return rows.filter(function (r) { return r.date === todayKey; });
  if (range === 'week') {
    var cutoff = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000);
    return rows.filter(function (r) {
      var parts = r.date.split('-').map(Number);
      var d = new Date(parts[0], parts[1] - 1, parts[2]);
      return d >= new Date(cutoff.getFullYear(), cutoff.getMonth(), cutoff.getDate());
    });
  }
  return rows;
}

function aggregate(rows) {
  // Each sample represents SAMPLE_MS of observation.
  var byCategory = {};
  var activeMs = 0;
  var idleMs = 0;
  var sessions = [];
  rows.forEach(function (r) {
    var s = r.session;
    if (!s || !Array.isArray(s.samples)) return;
    var sessActive = 0, sessIdle = 0;
    s.samples.forEach(function (sample) {
      var cat = sample.category || 'other';
      byCategory[cat] = (byCategory[cat] || 0) + SAMPLE_MS;
      if (sample.idle) { idleMs += SAMPLE_MS; sessIdle += SAMPLE_MS; }
      else { activeMs += SAMPLE_MS; sessActive += SAMPLE_MS; }
    });
    sessions.push({
      taskName: s.taskName || 'untitled',
      startTs: s.startTs,
      endTs: s.endTs,
      activeMs: sessActive,
      idleMs: sessIdle
    });
  });
  return {
    byCategory: byCategory,
    activeMs: activeMs,
    idleMs: idleMs,
    focusMs: activeMs + idleMs,
    sessions: sessions
  };
}

function completedInRange(range) {
  var stack = ls('stack') || {};
  var complete = stack.complete || [];
  var today = new Date();
  var todayKey = dateKey(today);
  if (range === 'today') {
    return complete.filter(function (t) {
      if (!t.completionDate) return false;
      var d = new Date(t.completionDate);
      return dateKey(d) === todayKey;
    }).length;
  }
  if (range === 'week') {
    var cutoff = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000);
    return complete.filter(function (t) {
      if (!t.completionDate) return false;
      var d = new Date(t.completionDate);
      return d >= new Date(cutoff.getFullYear(), cutoff.getMonth(), cutoff.getDate());
    }).length;
  }
  return complete.length;
}

function computeStreak(rows) {
  if (!rows || !rows.length) return 0;
  var days = {};
  rows.forEach(function (r) { days[r.date] = true; });
  var d = new Date();
  var streak = 0;
  while (true) {
    var key = dateKey(d);
    if (days[key]) { streak++; d.setDate(d.getDate() - 1); }
    else break;
    if (streak > 365) break;
  }
  return streak;
}

function formatDuration(ms) {
  var mins = Math.round(ms / 60000);
  if (mins < 60) return mins + 'm';
  var h = Math.floor(mins / 60);
  var m = mins % 60;
  return h + 'h ' + (m ? m + 'm' : '');
}

function formatTime(ts) {
  if (!ts) return '';
  var d = new Date(ts);
  var hh = d.getHours();
  var mm = d.getMinutes();
  var ap = hh >= 12 ? 'pm' : 'am';
  var h = hh % 12; if (!h) h = 12;
  return h + ':' + (mm < 10 ? '0' + mm : mm) + ap;
}

var categoryChart = null;

function render(range) {
  var all = loadSessions();
  var $empty = $('#emptyState');
  var $content = $('#content');
  if (all === null) {
    $empty.text('Reports are currently available in Local mode. Sign in with a cloud backend to see cloud sync of activity coming soon.').show();
    $content.hide();
    return;
  }
  var scoped = filterRange(all, range);
  var agg = aggregate(scoped);

  if (!agg.focusMs && !agg.sessions.length) {
    $empty.text('No activity recorded for this range yet. Clock into a task and the tracker will capture idle/active metadata locally.').show();
    $content.hide();
    return;
  }
  $empty.hide();
  $content.show();

  $('#kpiFocus').text(formatDuration(agg.focusMs));
  var activePct = agg.focusMs ? Math.round((agg.activeMs / agg.focusMs) * 100) : 0;
  $('#kpiActive').text(activePct + '%');
  $('#kpiCompleted').text(completedInRange(range));
  $('#kpiStreak').text(computeStreak(all) + 'd');

  // Category doughnut — cap at top 5 categories, legend at bottom.
  var catAll = Object.keys(agg.byCategory).sort(function (a, b) { return agg.byCategory[b] - agg.byCategory[a]; });
  var catLabels = catAll.slice(0, 5);
  var catData = catLabels.map(function (k) { return Math.round(agg.byCategory[k] / 60000); });
  var catColors = catLabels.map(function (k) { return CATEGORY_COLORS[k] || '#8b96a8'; });
  if (categoryChart) categoryChart.destroy();
  categoryChart = new Chart(document.getElementById('categoryChart').getContext('2d'), {
    type: 'doughnut',
    data: { labels: catLabels, datasets: [{ data: catData, backgroundColor: catColors, borderWidth: 0, hoverOffset: 4 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      cutout: '68%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: '#c5cbd5', font: { size: 10 }, boxWidth: 8, boxHeight: 8,
            padding: 6, usePointStyle: true, pointStyle: 'circle'
          }
        },
        tooltip: { callbacks: { label: function (ctx) { return ctx.label + ': ' + ctx.parsed + 'm'; } } }
      }
    }
  });

  // Sessions list — cap at 10.
  var $s = $('#sessionsList').empty();
  var reversed = agg.sessions.slice().sort(function (a, b) { return (b.startTs || 0) - (a.startTs || 0); }).slice(0, 10);
  reversed.forEach(function (s) {
    $s.append(
      '<div class="session-row">' +
        '<span class="session-name" title="' + (s.taskName || '').replace(/"/g, '') + '">' + (s.taskName || 'untitled') + '</span>' +
        '<span class="session-meta">' + formatTime(s.startTs) + ' · ' + formatDuration((s.activeMs || 0) + (s.idleMs || 0)) + '</span>' +
      '</div>'
    );
  });
}

$(document).ready(function () {
  $('#backButton').on('click', function () { window.location.replace('./stack.html'); });
  $('.tab').on('click', function () {
    $('.tab').removeClass('active');
    $(this).addClass('active');
    render($(this).data('range'));
  });
  render('today');
});
