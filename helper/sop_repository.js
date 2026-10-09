var ls = require('local-storage');
var engine = require('./sop_engine');
var KEY = 'sopLibrary';

function library() { return ls(KEY) || { schemaVersion: 1, sops: [], runs: [] }; }
function save(value) { ls(KEY, value); return value; }

exports.list = function () { return library().sops || []; };
exports.get = function (id) { return (library().sops || []).find(function (s) { return s.id === id; }) || null; };
exports.save = function (sop) {
  var validation = engine.validate(sop);
  if (!validation.ok) throw new Error(validation.errors.join(' '));
  var data = library();
  var index = data.sops.findIndex(function (s) { return s.id === sop.id; });
  var now = new Date().toISOString();
  var next = JSON.parse(JSON.stringify(sop));
  next.version = index >= 0 ? (parseInt(data.sops[index].version, 10) || 1) + 1 : 1;
  next.createdAt = index >= 0 ? data.sops[index].createdAt : now;
  next.updatedAt = now;
  if (index >= 0) data.sops[index] = next; else data.sops.push(next);
  save(data); return next;
};
exports.findParents = function (id) {
  return exports.list().filter(function (sop) {
    return (sop.steps || []).some(function (step) { return step.type === 'call_sop' && step.sopId === id; });
  });
};
exports.findDependents = function (id) {
  var found = [], queued = [id], seen = {};
  while (queued.length) {
    var childId = queued.shift();
    exports.findParents(childId).forEach(function (parent) {
      if (seen[parent.id]) return;
      seen[parent.id] = true;
      found.push(parent);
      queued.push(parent.id);
    });
  }
  return found;
};
exports.remove = function (id) {
  var data = library();
  data.sops = data.sops.filter(function (s) { return s.id !== id; });
  save(data);
};
exports.recordRun = function (run) { var data = library(); data.runs = data.runs || []; data.runs.unshift(run); data.runs = data.runs.slice(0, 200); save(data); return run; };
exports.runs = function () { return library().runs || []; };

function backendPath() { return 'sops/index.json'; }
function legacyBackendPath() { return 'fastack_sops'; }
exports.syncToCloud = function (callback) {
  var github = require('./github_functions'), dropbox = require('./dropbox_functions'), gdrive = require('./gdrive_functions'), local = require('./local_functions');
  var cb = callback || function () {};
  var payload = JSON.stringify(library());
  var platform = ls('platform'), token = ls('token'), repo = ls('repoName');
  local.createUpdateFile('', 'local/' + backendPath(), payload, function (localErr) {
    if (localErr) return cb(localErr);
    if (platform === 'Github') return github.createUpdateFile(token, ls('username'), repo, backendPath(), payload, cb);
    if (platform === 'Dropbox') return dropbox.createUpdateFile(token, repo + '/' + backendPath(), payload, cb);
    if (platform === 'Google') return gdrive.createUpdateFile(token, repo + '/' + backendPath(), payload, cb);
    if (platform === 'Local') return local.createUpdateFile('', repo + '/' + backendPath(), payload, cb);
    cb(null);
  });
};

exports.syncFromCloud = function (callback) {
  var github = require('./github_functions'), dropbox = require('./dropbox_functions'), gdrive = require('./gdrive_functions'), local = require('./local_functions');
  var cb = callback || function () {};
  var platform = ls('platform'), token = ls('token'), repo = ls('repoName');
  function apply(text) {
    try {
      var parsed = JSON.parse(text);
      if (parsed && Array.isArray(parsed.sops)) {
        save(parsed);
        return local.createUpdateFile('', 'local/' + backendPath(), JSON.stringify(parsed), function () { cb(null, parsed); });
      }
    } catch (e) {}
    cb(null, library());
  }
  function done(err, text) { if (err || !text) return cb(null, library()); apply(text); }
  if (platform === 'Github') return github.getContent(token, ls('username'), backendPath(), repo, function (err, result) {
    if (err || !result || !result.content) return github.getContent(token, ls('username'), legacyBackendPath(), repo, function (oldErr, oldResult) { if (oldErr || !oldResult || !oldResult.content) return done(err); try { done(null, Buffer.from(oldResult.content.replace(/\s/g, ''), 'base64').toString('utf8')); } catch (e) { done(e); } });
    try { done(null, Buffer.from(result.content.replace(/\s/g, ''), 'base64').toString('utf8')); } catch (e) { done(e); }
  });
  if (platform === 'Dropbox') return dropbox.getContent(token, '/' + repo + '/' + backendPath(), function (err, text) { if (!err && text) return done(null, text); dropbox.getContent(token, '/' + repo + '/' + legacyBackendPath(), done); });
  if (platform === 'Google') return gdrive.getContent(token, repo + '/' + backendPath(), function (err, text) { if (!err && text) return done(null, text); gdrive.getContent(token, repo + '/' + legacyBackendPath(), done); });
  if (platform === 'Local') return local.getContent('', repo + '/' + backendPath(), function (err, text) { if (!err && text) return done(null, text); local.getContent('', repo + '/' + legacyBackendPath(), done); });
  cb(null, library());
};
