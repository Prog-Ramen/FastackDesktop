// Local-first task intelligence. Pure functions: no network, model, or storage access.
// These deterministic fallbacks keep insights instant and private even when the
// optional local language model is unavailable.

function words(value) {
  var stop = { the:1, a:1, an:1, and:1, or:1, to:1, for:1, of:1, in:1, on:1, with:1, task:1 };
  return String(value || '').toLowerCase().match(/[a-z0-9]+/g) || []
    .filter(function (w) { return w.length > 1 && !stop[w]; });
}

function taskText(task) {
  return [task.taskName, task.description, task.tags, task.notes].filter(Boolean).join(' ');
}

function similarity(a, b) {
  var aw = words(a), bw = words(b);
  if (!aw.length || !bw.length) return 0;
  var as = {}; aw.forEach(function (w) { as[w] = true; });
  var bs = {}; bw.forEach(function (w) { bs[w] = true; });
  var intersection = Object.keys(as).filter(function (w) { return bs[w]; }).length;
  var union = Object.keys(Object.assign({}, as, bs)).length;
  return union ? intersection / union : 0;
}

function estimatedMs(task) {
  return ((parseInt(task.timeHours, 10) || 0) * 60 + (parseInt(task.timeMins, 10) || 0)) * 60000;
}

exports.searchTasks = function (query, tasks, limit) {
  return (tasks || []).map(function (task) {
    return { task: task, score: similarity(query, taskText(task)) };
  }).filter(function (row) { return row.score > 0; })
    .sort(function (a, b) { return b.score - a.score; }).slice(0, limit || 5);
};

exports.suggestEstimate = function (title, completed) {
  var matches = exports.searchTasks(title, completed || [], 5).filter(function (row) {
    return row.score >= 0.12 && (parseInt(row.task.timeTaken, 10) || 0) > 0;
  });
  if (!matches.length) return null;
  var weighted = 0, weights = 0;
  matches.forEach(function (row) {
    weighted += (parseInt(row.task.timeTaken, 10) || 0) * row.score;
    weights += row.score;
  });
  var minutes = Math.max(5, Math.round(weighted / weights / 300000) * 5);
  return { minutes: minutes, confidence: Math.min(0.95, matches[0].score + matches.length * 0.08), examples: matches.length };
};

exports.decomposeTask = function (title) {
  var subject = String(title || 'the task').trim();
  return [
    'Define the outcome and acceptance criteria for ' + subject,
    'Gather the required context and dependencies',
    'Complete the smallest testable version',
    'Review, validate, and capture follow-up work'
  ];
};

exports.completionSummary = function (task) {
  var mins = Math.max(0, Math.round((parseInt(task.timeTaken, 10) || 0) / 60000));
  var result = 'Completed “' + (task.taskName || 'Untitled task') + '”';
  if (mins) result += ' after ' + mins + ' focused minute' + (mins === 1 ? '' : 's');
  if (task.description) result += '. Outcome: ' + String(task.description).trim().replace(/\s+/g, ' ');
  return result + '.';
};

exports.rankTasks = function (tasks, now) {
  now = now || Date.now();
  return (tasks || []).map(function (task) {
    var priority = parseInt(task.priority, 10) || 1;
    var estimateMinutes = estimatedMs(task) / 60000;
    var due = task.ignoreDates ? null : new Date(task.completionDate).getTime();
    var urgency = due && isFinite(due) ? Math.max(-30, Math.min(80, (7 - (due - now) / 86400000) * 10)) : 0;
    var quickWin = estimateMinutes > 0 && estimateMinutes <= 30 ? 12 : 0;
    return { task: task, score: priority + urgency + quickWin, reason: urgency > 30 ? 'Deadline pressure' : quickWin ? 'Quick win' : 'Priority' };
  }).sort(function (a, b) { return b.score - a.score; });
};

exports.findStaleTasks = function (tasks, now) {
  now = now || Date.now();
  return (tasks || []).filter(function (task) {
    var created = new Date(task.creationDate).getTime();
    var due = task.ignoreDates ? null : new Date(task.completionDate).getTime();
    return (isFinite(created) && now - created > 14 * 86400000) || (due && isFinite(due) && due < now);
  }).map(function (task) {
    var created = new Date(task.creationDate).getTime();
    return { task: task, ageDays: isFinite(created) ? Math.floor((now - created) / 86400000) : null, suggestion: estimatedMs(task) > 90 * 60000 ? 'Split into smaller tasks' : 'Reschedule or clarify the next action' };
  });
};

exports.analyzeSessions = function (rows) {
  var samples = 0, active = 0, idle = 0, switches = 0, byHour = {}, byCategory = {};
  (rows || []).forEach(function (row) {
    var session = row.session || row;
    if (!session || !Array.isArray(session.samples)) return;
    switches++;
    var hour = new Date(session.startTs || 0).getHours();
    if (!byHour[hour]) byHour[hour] = { active: 0, total: 0 };
    session.samples.forEach(function (sample) {
      samples++; byHour[hour].total++;
      var cat = sample.category || 'other'; byCategory[cat] = (byCategory[cat] || 0) + 1;
      if (sample.idle) idle++; else { active++; byHour[hour].active++; }
    });
  });
  var bestHour = null;
  Object.keys(byHour).forEach(function (hour) {
    if (bestHour === null || byHour[hour].active > byHour[bestHour].active) bestHour = hour;
  });
  var activePct = samples ? Math.round(active / samples * 100) : 0;
  var fragmentationPenalty = Math.max(0, switches - Math.ceil(active / 60)) * 4;
  return {
    focusScore: Math.max(0, Math.min(100, activePct - fragmentationPenalty)),
    activePct: activePct,
    sessionCount: switches,
    interruptionRisk: switches >= 8 ? 'high' : switches >= 4 ? 'medium' : 'low',
    bestHour: bestHour === null ? null : parseInt(bestHour, 10),
    dominantCategory: Object.keys(byCategory).sort(function (a, b) { return byCategory[b] - byCategory[a]; })[0] || null
  };
};

exports.weeklyReview = function (stack, rows) {
  stack = stack || {};
  var analysis = exports.analyzeSessions(rows);
  var completed = (stack.complete || []).filter(function (task) {
    var at = new Date(task.completedAt || task.completionDate).getTime();
    return isFinite(at) && Date.now() - at <= 7 * 86400000;
  });
  var stale = exports.findStaleTasks(stack.incomplete || []);
  var estimatePairs = completed.filter(function (t) { return estimatedMs(t) && parseInt(t.timeTaken, 10); });
  var accuracy = null;
  if (estimatePairs.length) {
    accuracy = Math.round(estimatePairs.reduce(function (sum, t) { return sum + Math.min(2, (parseInt(t.timeTaken, 10) || 0) / estimatedMs(t)); }, 0) / estimatePairs.length * 100);
  }
  return { completed: completed.length, stale: stale.length, focusScore: analysis.focusScore, estimateAccuracy: accuracy, bestHour: analysis.bestHour };
};

exports._similarity = similarity;
