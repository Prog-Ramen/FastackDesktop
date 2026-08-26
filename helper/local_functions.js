// Local filesystem backend for Fastack.
// Mirrors the surface of github_functions.js / dropbox_functions.js / gdrive_functions.js
// but writes to <userData>/fastack-local/ instead of a cloud service.
//
// Layout matches the cloud backends:
//   <userData>/fastack-local/<repoName>/
//     fastack-0-local           <- marker file (so checkFastackRepoExists works)
//     fastack_settings          <- settings JSON
//     <year>/<month>/<day>      <- daily stack snapshots (JSON text)
//
// The `token` argument is ignored — it's kept in the signature so the helper is drop-in
// compatible with the other backends. Callers just pass ls('token') = "" (or anything).

var fs = require('fs');
var path = require('path');
var remote = require('@electron/remote');

function rootDir() {
  var userData = remote.app.getPath('userData');
  var root = path.join(userData, 'fastack-local');
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  return root;
}

function repoDir(repoName) {
  return path.join(rootDir(), repoName || 'local');
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function safeCallback(fn) {
  // Fire callbacks asynchronously so they behave like the other backends (which are all Promise-based).
  return function () {
    var args = Array.prototype.slice.call(arguments);
    setTimeout(function () { fn.apply(null, args); }, 0);
  };
}

exports.rootDir = rootDir; // exported so the settings UI can show it if useful.

exports.makeRepo = function (token, repoName, callback) {
  var cb = safeCallback(callback);
  try {
    var dir = repoDir(repoName);
    ensureDir(dir);
    // Marker file, mirrors the fastack-<n>-<username> convention on Github.
    fs.writeFileSync(path.join(dir, 'fastack-0-local'), '');
    return cb(null, 'success');
  } catch (e) {
    return cb(e, null);
  }
};

exports.checkFastackRepoExists = function (token, callback) {
  var cb = safeCallback(callback);
  try {
    var root = rootDir();
    var entries = fs.readdirSync(root, { withFileTypes: true });
    var match = entries.find(function (e) { return e.isDirectory(); });
    return cb(null, match ? match.name : '');
  } catch (e) {
    return cb(e, null);
  }
};

// filepath is "<repoName>/<segment>/<segment>/..." — everything after rootDir.
exports.getContent = function (token, filepath, callback) {
  var cb = safeCallback(callback);
  try {
    var full = path.join(rootDir(), filepath);
    if (!fs.existsSync(full)) return cb(new Error('Not found: ' + filepath), null);
    var text = fs.readFileSync(full, 'utf8');
    return cb(null, text);
  } catch (e) {
    return cb(e, null);
  }
};

// path is directory-relative to the local root; returns entries [{name, isDir}].
exports.listFiles = function (token, dirPath, callback) {
  var cb = safeCallback(callback);
  try {
    var full = path.join(rootDir(), dirPath.replace(/^\/+/, ''));
    if (!fs.existsSync(full)) return cb(null, []);
    var entries = fs.readdirSync(full, { withFileTypes: true });
    var result = entries.map(function (e) { return { name: e.name, isDir: e.isDirectory() }; });
    return cb(null, result);
  } catch (e) {
    return cb(e, null);
  }
};

exports.checkFileExists = function (token, folder, filename, callback) {
  var cb = safeCallback(callback);
  try {
    var full = path.join(rootDir(), folder, filename);
    if (!fs.existsSync(full)) return cb(null, null);
    return cb(null, { path: full, name: filename });
  } catch (e) {
    return cb(null, null);
  }
};

// filepath is "<repoName>/<year>/<month>/<day>" — full path minus the root.
// Any missing parent dirs are created.
exports.createUpdateFile = function (token, filepath, fileContent, callback) {
  var cb = safeCallback(callback);
  try {
    var full = path.join(rootDir(), filepath);
    ensureDir(path.dirname(full));
    fs.writeFileSync(full, fileContent, 'utf8');
    return cb(null, 'Successfully wrote ' + filepath);
  } catch (e) {
    return cb(e, null);
  }
};

// Walk the entire repoDir tree and return all snapshot files as
// [{ datePath: "2026/7/9", content: "<json>" }, ...].
// Used by the push-to-cloud migration.
exports.readAllSnapshots = function (repoName) {
  var out = [];
  var base = repoDir(repoName);
  if (!fs.existsSync(base)) return out;
  var years = fs.readdirSync(base, { withFileTypes: true }).filter(function (e) { return e.isDirectory() && /^\d{4}$/.test(e.name); });
  years.forEach(function (yEnt) {
    var yDir = path.join(base, yEnt.name);
    var months = fs.readdirSync(yDir, { withFileTypes: true }).filter(function (e) { return e.isDirectory() && /^\d{1,2}$/.test(e.name); });
    months.forEach(function (mEnt) {
      var mDir = path.join(yDir, mEnt.name);
      var days = fs.readdirSync(mDir, { withFileTypes: true }).filter(function (e) { return e.isFile() && /^\d{1,2}$/.test(e.name); });
      days.forEach(function (dEnt) {
        out.push({
          datePath: yEnt.name + '/' + mEnt.name + '/' + dEnt.name,
          content: fs.readFileSync(path.join(mDir, dEnt.name), 'utf8')
        });
      });
    });
  });
  return out;
};

// Read a single named file (e.g. "fastack_settings") from the repo root.
exports.readNamedFile = function (repoName, filename) {
  var full = path.join(repoDir(repoName), filename);
  if (!fs.existsSync(full)) return null;
  return fs.readFileSync(full, 'utf8');
};

// Walk <repoDir>/activity/<year>/<month>/<day> and return every session as a flat
// list: [{ date: 'YYYY-M-D', session: {...} }, ...]. Used by the report page.
exports.readAllActivity = function (repoName) {
  var out = [];
  var base = path.join(repoDir(repoName), 'activity');
  if (!fs.existsSync(base)) return out;
  var years = fs.readdirSync(base, { withFileTypes: true }).filter(function (e) { return e.isDirectory() && /^\d{4}$/.test(e.name); });
  years.forEach(function (yEnt) {
    var yDir = path.join(base, yEnt.name);
    var months = fs.readdirSync(yDir, { withFileTypes: true }).filter(function (e) { return e.isDirectory() && /^\d{1,2}$/.test(e.name); });
    months.forEach(function (mEnt) {
      var mDir = path.join(yDir, mEnt.name);
      var days = fs.readdirSync(mDir, { withFileTypes: true }).filter(function (e) { return e.isFile() && /^\d{1,2}$/.test(e.name.replace(/\.json$/, '')); });
      days.forEach(function (dEnt) {
        var raw = fs.readFileSync(path.join(mDir, dEnt.name), 'utf8');
        var sessions;
        try { sessions = JSON.parse(raw); } catch (e) { return; }
        if (!Array.isArray(sessions)) return;
        var dateKey = yEnt.name + '-' + mEnt.name + '-' + dEnt.name.replace(/\.json$/, '');
        sessions.forEach(function (s) { out.push({ date: dateKey, session: s }); });
      });
    });
  });
  return out;
};
