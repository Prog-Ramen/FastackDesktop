// Deterministic reconciliation for stacks coming from local and cloud stores.
// A task ID is the canonical identity; legacy tasks fall back to name + creation date.
function identity(task) { return task && (task.taskId || ((task.taskName || '') + '|' + (task.creationDate || ''))); }
function stamp(task) {
  var value = task && (task.updatedAt || task.modifiedAt || task.completedAt || task.creationDate);
  var time = value ? new Date(value).getTime() : 0;
  return isFinite(time) ? time : 0;
}
function descriptionRevision(task) {
  var rev = task && task.fieldRevisions && task.fieldRevisions.description;
  return rev || { updatedAt: task && task.updatedAt || task && task.creationDate || 0, source: task && task.sourceDevice || 'unknown', value: task && task.description || '' };
}
function mergeDescription(existing, incoming, winner) {
  var a = String(existing.description || ''), b = String(incoming.description || '');
  if (a === b || !a || !b) return winner;
  var conflicts = (winner.descriptionConflicts || []).slice();
  var add = function (rev) {
    var sig = String(rev.source) + '|' + String(rev.updatedAt) + '|' + String(rev.value);
    if (!conflicts.some(function (x) { return String(x.source) + '|' + String(x.updatedAt) + '|' + String(x.value) === sig; })) conflicts.push(rev);
  };
  add(descriptionRevision(existing)); add(descriptionRevision(incoming));
  winner.descriptionConflicts = conflicts;
  winner.hasConflicts = true;
  return winner;
}
function mergeSessions(existing, incoming, winner) {
  var sessions = (existing.timeSessions || []).concat(incoming.timeSessions || []), seen = {};
  winner.timeSessions = sessions.filter(function (s) { if (!s || !s.sessionId || seen[s.sessionId]) return false; seen[s.sessionId] = true; return true; });
  if (winner.timeSessions.length) winner.timeTaken = winner.timeSessions.reduce(function (sum, s) { return sum + (Number(s.durationMs) || Math.max(0, new Date(s.stoppedAt || Date.now()).getTime() - new Date(s.startedAt || Date.now()).getTime())); }, 0);
  return winner;
}
function mergeStacks() {
  var byId = {}, order = [];
  Array.prototype.slice.call(arguments).forEach(function (stack) {
    if (!stack) return;
    (stack.incomplete || []).concat(stack.complete || []).forEach(function (task) {
      if (!task) return;
      var id = identity(task); if (!id) return;
      var existing = byId[id];
      if (!existing) { byId[id] = task; order.push(id); return; }
      // Newer records win fields, while preserving fields only present in the older record.
      var winner = stamp(task) >= stamp(existing) ? Object.assign({}, existing, task) : Object.assign({}, task, existing);
      byId[id] = mergeSessions(existing, task, mergeDescription(existing, task, winner));
    });
  });
  var tasks = order.map(function (id) { return byId[id]; });
  var compare = function (a, b) {
    var ad = a.ignoreDates ? Infinity : new Date(a.completionDate || a.startDate || 8640000000000000).getTime();
    var bd = b.ignoreDates ? Infinity : new Date(b.completionDate || b.startDate || 8640000000000000).getTime();
    if (!isFinite(ad)) ad = Infinity; if (!isFinite(bd)) bd = Infinity;
    return (ad - bd) || ((Number(b.priority) || 0) - (Number(a.priority) || 0)) || (stamp(a) - stamp(b)) || (new Date(a.creationDate || 0) - new Date(b.creationDate || 0));
  };
  tasks.sort(compare);
  var result = { incomplete: [], complete: [], templates: [] };
  tasks.forEach(function (task) { (task.complete ? result.complete : result.incomplete).push(task); });
  for (var i = 0; i < arguments.length; i++) if (arguments[i] && arguments[i].templates) result.templates = result.templates.concat(arguments[i].templates); 
  return result;
}
exports.identity = identity;
exports.mergeStacks = mergeStacks;
