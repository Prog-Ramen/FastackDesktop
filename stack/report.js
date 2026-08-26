// Deterministic productivity report.
//
// Reads all activity sessions from the active backend, aggregates per range
// (today / week / all), and renders KPIs + Chart.js pies/bars.
// No model calls, no external requests. Pure rollup.

var ls = require('local-storage');
var localFunctions = require('../helper/local_functions');

var SAMPLE_MS = 5000;              // Must match activity_tracker.SAMPLE_MS
var CATEGORY_COLORS = {
  code:   '#3ea680',
  browse: '#5b9cd6',
  read:   '#c48ac0',
  write:  '#e0a760',
  comms:  '#d15656',
  idle:   '#6b7383',
  other:  '#8b96a8'
};

function loadSessions() {
  // For now the report reads the local-backend activity tree directly.
  // Cloud backends store the same shape via activity_tracker.stop(), so a
  // future extension can add per-backend enumerators; the aggregation code
  // below is agnostic to source.
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
  // Each sample represents SAMPLE_MS of observation. Categories/apps get
  // that block of time added, so totals are in ms.
  var byCategory = {};
  var byApp = {};
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
      else {
        activeMs += SAMPLE_MS;
        sessActive += SAMPLE_MS;
        var app = sample.app || 'unknown';
        byApp[app] = (byApp[app] || 0) + SAMPLE_MS;
      }
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
    byApp: byApp,
    activeMs: activeMs,
    idleMs: idleMs,
    focusMs: activeMs + idleMs,
    sessions: sessions
  };
}

function completedInRange(range) {
  // "Completed" is derived from ls('stack').complete. Range filter uses each
  // task's completionDate if available, else it lands in "all".
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
  // Consecutive days ending today with at least one recorded session.
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
var appsChart = null;

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
    $empty.text('No activity recorded for this range yet. Clock into a task and the tracker will capture app/idle metadata locally.').show();
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

  // Category doughnut — cap at top 6 categories so labels remain readable,
  // and put the legend at the bottom (300px wide popup can't afford a side legend).
  var catAll = Object.keys(agg.byCategory).sort(function (a, b) { return agg.byCategory[b] - agg.byCategory[a]; });
  var catLabels = catAll.slice(0, 6);
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

  // Top apps horizontal bar — cap 5, truncate long labels.
  var appEntries = Object.keys(agg.byApp).map(function (k) { return [k, agg.byApp[k]]; });
  appEntries.sort(function (a, b) { return b[1] - a[1]; });
  appEntries = appEntries.slice(0, 5);
  var truncApp = function (name) { return name && name.length > 18 ? name.slice(0, 16) + '…' : name; };
  if (appsChart) appsChart.destroy();
  appsChart = new Chart(document.getElementById('appsChart').getContext('2d'), {
    type: 'bar',
    data: {
      labels: appEntries.map(function (e) { return truncApp(e[0]); }),
      datasets: [{
        data: appEntries.map(function (e) { return Math.round(e[1] / 60000); }),
        backgroundColor: '#5b9cd6',
        borderRadius: 4,
        barThickness: 14
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      indexAxis: 'y',
      layout: { padding: { right: 4 } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (ctx) { return ctx.parsed.x + 'm'; } } } },
      scales: {
        x: { ticks: { color: '#8b96a8', font: { size: 10 }, precision: 0 }, grid: { color: 'rgba(255,255,255,0.04)' } },
        y: { ticks: { color: '#f5f7fa', font: { size: 10.5 } }, grid: { display: false } }
      }
    }
  });

  // Sessions list — cap at 10 (outer scroll handles the rest of the page).
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
