var ls = require('local-storage');
var TTL = 30 * 60 * 1000;
function device() { var id = ls('fastackDeviceId'); if (!id) { id = 'device_' + Math.random().toString(36).slice(2); ls('fastackDeviceId', id); } return id; }
function valid(lock) { return lock && lock.expiresAt > Date.now(); }
exports.acquire = function (task, type) {
  if (!task) return { ok: false, reason: 'Task not found' };
  var current = task.lock;
  if (valid(current) && current.owner !== device()) return { ok: false, lock: current };
  task.lock = { owner: device(), type: type || 'edit', acquiredAt: Date.now(), expiresAt: Date.now() + TTL };
  return { ok: true, lock: task.lock };
};
exports.release = function (task) { if (task && task.lock && task.lock.owner === device()) delete task.lock; };
exports.isHeldByOther = function (task) { return !!(task && valid(task.lock) && task.lock.owner !== device()); };
exports.deviceId = device;
