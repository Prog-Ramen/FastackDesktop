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
var intelligence = require('../helper/intelligence');

var SAMPLE_MS = 5000;              // Must match activity_tracker.SAMPLE_MS
var CATEGORY_COLORS = {
  write:  '#e0a760',
  read:   '#c48ac0',
  browse: '#5b9cd6',
  idle:   '#6b7383',
  other:  '#8b96a8'
};

function loadSessions() {
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
  if (all === null) all = [];
  var scoped = filterRange(all, range);
  var agg = aggregate(scoped);
  $('#weeklyReviewBlock').toggle(range === 'week');

  if (!agg.focusMs && !agg.sessions.length) $empty.text('No activity samples for this range yet. Task insights below are still available.').show();
  else $empty.hide();
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
  var chartValues = catData.length ? catData : [1];
  var chartLabels = catLabels.length ? catLabels : ['No activity'];
  var chartColors = catColors.length ? catColors : ['#303844'];
  categoryChart = new Chart(document.getElementById('categoryChart').getContext('2d'), {
    type: 'doughnut',
    data: { labels: chartLabels, datasets: [{ data: chartValues, backgroundColor: chartColors, borderWidth: 0, hoverOffset: 4 }] },
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

  renderIntelligence(scoped);
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, function (c) { return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]; });
}

function hourLabel(hour) {
  if (hour === null || hour === undefined) return 'Not enough history yet';
  var suffix = hour >= 12 ? 'PM' : 'AM';
  var display = hour % 12 || 12;
  return 'Your strongest focus window starts around ' + display + ' ' + suffix + '.';
}

function renderIntelligence(rows) {
  var stack = ls('stack') || { incomplete: [], complete: [] };
  var analysis = intelligence.analyzeSessions(rows);
  var review = intelligence.weeklyReview(stack, rows);
  $('#focusInsight').text(rows.length ? analysis.focusScore + '/100 · ' + analysis.activePct + '% of observed time was active.' : 'Clock into tasks to build a private focus-quality baseline.');
  $('#interruptionInsight').text(rows.length ? analysis.sessionCount + ' sessions · ' + analysis.interruptionRisk + ' fragmentation risk.' : 'No interruption pattern available yet.');
  var activityLabels = { write: 'writing', read: 'reading', browse: 'browsing', idle: 'idle', other: 'in mixed activity' };
  $('#patternInsight').text(hourLabel(analysis.bestHour) + (analysis.dominantCategory ? ' Most time is spent ' + activityLabels[analysis.dominantCategory] + '.' : ''));
  $('#estimateInsight').text(review.estimateAccuracy === null ? 'Complete estimated tasks to compare planned and actual time.' : 'Actual time averages ' + review.estimateAccuracy + '% of the original estimate.');

  var ranked = intelligence.rankTasks(stack.incomplete || []).slice(0, 3);
  $('#nextTaskList').html(ranked.length ? ranked.map(function (row, i) {
    return '<div class="insight-row"><span><b>' + (i + 1) + '.</b> ' + escapeHtml(row.task.taskName) + '</span><small>' + escapeHtml(row.reason) + '</small></div>';
  }).join('') : '<div class="insight-empty">Your task list is clear.</div>');

  var stale = intelligence.findStaleTasks(stack.incomplete || []).slice(0, 5);
  $('#staleTaskList').html(stale.length ? stale.map(function (row) {
    return '<div class="insight-row"><span>' + escapeHtml(row.task.taskName) + '</span><small>' + escapeHtml(row.suggestion) + '</small></div>';
  }).join('') : '<div class="insight-empty">No stale or overdue tasks.</div>');

  var reviewText = review.completed + ' task' + (review.completed === 1 ? '' : 's') + ' completed this week. Focus quality is ' + review.focusScore + '/100. ' + review.stale + ' task' + (review.stale === 1 ? '' : 's') + ' need attention.';
  if (review.bestHour !== null) reviewText += ' ' + hourLabel(review.bestHour);
  $('#weeklyReview').text(reviewText).data('review', reviewText);

  var summaries = (stack.complete || []).slice().reverse().slice(0, 5);
  $('#completionSummaries').html(summaries.length ? summaries.map(function (task) {
    return '<div class="insight-row"><span>' + escapeHtml(task.completionSummary || intelligence.completionSummary(task)) + '</span></div>';
  }).join('') : '<div class="insight-empty">Completed tasks will be summarized here.</div>');
}

$(document).ready(function () {
  $('#backButton').on('click', function () { window.location.replace('./stack.html'); });
  $('.tab').on('click', function () {
    $('.tab').removeClass('active');
    $(this).addClass('active');
    render($(this).data('range'));
  });
  $('#taskSearch').on('input', function () {
    var query = $(this).val().trim();
    var stack = ls('stack') || { incomplete: [], complete: [] };
    var $results = $('#searchResults');
    if (query.length < 2) { $results.hide().empty(); return; }
    var hits = intelligence.searchTasks(query, (stack.incomplete || []).concat(stack.complete || []), 6);
    $results.html(hits.length ? hits.map(function (hit) {
      return '<div class="insight-row"><span>' + escapeHtml(hit.task.taskName) + '</span><small>' + Math.round(hit.score * 100) + '% match</small></div>';
    }).join('') : '<div class="insight-empty">No related tasks found.</div>').show();
  });
  $('#copyReview').on('click', function () {
    var text = $('#weeklyReview').data('review') || $('#weeklyReview').text();
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text);
    $(this).text('Copied');
  });
  render('today');
});
