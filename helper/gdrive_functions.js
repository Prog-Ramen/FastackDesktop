// Google Drive backend for Fastack.
// Mirrors the surface of github_functions.js / dropbox_functions.js:
//   makeRepo, getContent, listFiles, checkFastackRepoExists, checkFileExists, createUpdateFile.
//
// Drive model:
//   * A single "Fastack-<name>" folder at the Drive root is the "repo".
//   * Stack snapshots are written under year/month/day nested folders (matches Github layout).
//   * All identifiers passed around are Drive folder/file IDs; paths are resolved on demand.

var ls = require('local-storage');

var DRIVE_API = 'https://www.googleapis.com/drive/v3';
var UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
var FOLDER_MIME = 'application/vnd.google-apps.folder';

function authHeaders(token, extra) {
  var headers = { 'Authorization': 'Bearer ' + token };
  if (extra) {
    Object.keys(extra).forEach(function (k) { headers[k] = extra[k]; });
  }
  return headers;
}

function driveFetch(url, options, callback) {
  fetch(url, options).then(function (response) {
    var ok = response.status < 400;
    response.text().then(function (text) {
      var json = null;
      if (text) {
        try { json = JSON.parse(text); } catch (e) { json = { raw: text }; }
      }
      if (ok) {
        return callback(null, json);
      }
      var msg = (json && json.error && json.error.message) || ('HTTP ' + response.status);
      return callback(new Error(msg), null);
    });
  }).catch(function (err) {
    return callback(err, null);
  });
}

function findChildFolder(token, parentId, name, callback) {
  var q = "'" + parentId + "' in parents and name = '" + name.replace(/'/g, "\\'") + "' and mimeType = '" + FOLDER_MIME + "' and trashed = false";
  var url = DRIVE_API + '/files?q=' + encodeURIComponent(q) + '&fields=files(id,name)';
  driveFetch(url, { method: 'GET', headers: authHeaders(token) }, function (err, json) {
    if (err) return callback(err, null);
    var match = json.files && json.files[0];
    return callback(null, match ? match.id : null);
  });
}

function findChildFile(token, parentId, name, callback) {
  var q = "'" + parentId + "' in parents and name = '" + name.replace(/'/g, "\\'") + "' and trashed = false";
  var url = DRIVE_API + '/files?q=' + encodeURIComponent(q) + '&fields=files(id,name,mimeType)';
  driveFetch(url, { method: 'GET', headers: authHeaders(token) }, function (err, json) {
    if (err) return callback(err, null);
    var match = json.files && json.files[0];
    return callback(null, match || null);
  });
}

function createFolder(token, parentId, name, callback) {
  var body = { name: name, mimeType: FOLDER_MIME };
  if (parentId) body.parents = [parentId];
  driveFetch(DRIVE_API + '/files?fields=id,name', {
    method: 'POST',
    headers: authHeaders(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body)
  }, function (err, json) {
    if (err) return callback(err, null);
    return callback(null, json.id);
  });
}

function ensureFolderPath(token, parts, callback) {
  // parts: ['Fastack-<name>', '2026', '7', '9'] — walk from root, creating as needed.
  var parentId = 'root';
  var i = 0;
  function step() {
    if (i >= parts.length) return callback(null, parentId);
    var name = parts[i];
    findChildFolder(token, parentId, name, function (err, id) {
      if (err) return callback(err, null);
      if (id) {
        parentId = id;
        i++;
        return step();
      }
      createFolder(token, parentId, name, function (err, newId) {
        if (err) return callback(err, null);
        parentId = newId;
        i++;
        return step();
      });
    });
  }
  step();
}

// -------- Exports (match the other backend helpers) --------

exports.makeRepo = function (token, repoName, callback) {
  var folderName = 'Fastack-' + repoName;
  findChildFolder(token, 'root', folderName, function (err, existing) {
    if (err) return callback(err, null);
    if (existing) return callback(null, 'exists');
    createFolder(token, 'root', folderName, function (err) {
      if (err) return callback(err, null);
      return callback(null, 'success');
    });
  });
};

exports.checkFastackRepoExists = function (token, callback) {
  var q = "'root' in parents and name contains 'Fastack-' and mimeType = '" + FOLDER_MIME + "' and trashed = false";
  var url = DRIVE_API + '/files?q=' + encodeURIComponent(q) + '&fields=files(id,name)';
  driveFetch(url, { method: 'GET', headers: authHeaders(token) }, function (err, json) {
    if (err) return callback(err, null);
    var match = json.files && json.files.find(function (f) { return f.name.indexOf('Fastack-') === 0; });
    return callback(null, match ? match.name : '');
  });
};

// path is a slash-delimited path *inside* the repo folder ("" for the repo root, "2026/7/9" for a snapshot dir).
exports.listFiles = function (token, path, callback) {
  var parts = String(path || '').split('/').filter(Boolean);
  // First segment is expected to be the Fastack-<name> folder.
  ensureRepoAndPath(token, parts, false, function (err, parentId) {
    if (err) return callback(err, null);
    var q = "'" + parentId + "' in parents and trashed = false";
    var url = DRIVE_API + '/files?q=' + encodeURIComponent(q) + '&fields=files(id,name,mimeType)&pageSize=1000';
    driveFetch(url, { method: 'GET', headers: authHeaders(token) }, function (err, json) {
      if (err) return callback(err, null);
      return callback(null, json.files || []);
    });
  });
};

function ensureRepoAndPath(token, parts, createIfMissing, callback) {
  if (parts.length === 0) {
    // Caller wants the drive root — unusual, but honor it.
    return callback(null, 'root');
  }
  var head = parts[0];
  findChildFolder(token, 'root', head, function (err, id) {
    if (err) return callback(err, null);
    if (!id) {
      if (!createIfMissing) return callback(new Error('Fastack folder ' + head + ' not found'), null);
      createFolder(token, 'root', head, function (err, newId) {
        if (err) return callback(err, null);
        walkFrom(newId, 1);
      });
      return;
    }
    walkFrom(id, 1);
  });

  function walkFrom(parentId, idx) {
    if (idx >= parts.length) return callback(null, parentId);
    var name = parts[idx];
    findChildFolder(token, parentId, name, function (err, id) {
      if (err) return callback(err, null);
      if (id) return walkFrom(id, idx + 1);
      if (!createIfMissing) return callback(new Error('Path segment not found: ' + name), null);
      createFolder(token, parentId, name, function (err, newId) {
        if (err) return callback(err, null);
        walkFrom(newId, idx + 1);
      });
    });
  }
}

exports.getContent = function (token, filepath, callback) {
  var parts = String(filepath || '').split('/').filter(Boolean);
  if (parts.length < 2) return callback(new Error('gdrive getContent: filepath must include repo folder + at least one segment'), null);
  var filename = parts.pop();
  ensureRepoAndPath(token, parts, false, function (err, parentId) {
    if (err) return callback(err, null);
    findChildFile(token, parentId, filename, function (err, file) {
      if (err) return callback(err, null);
      if (!file) return callback(null, null);
      var url = DRIVE_API + '/files/' + file.id + '?alt=media';
      fetch(url, { method: 'GET', headers: authHeaders(token) }).then(function (res) {
        if (res.status >= 400) {
          return res.text().then(function (t) { callback(new Error('Drive download failed: ' + t), null); });
        }
        res.text().then(function (text) { callback(null, text); });
      }).catch(function (e) { callback(e, null); });
    });
  });
};

exports.checkFileExists = function (token, folderPath, filename, callback) {
  var parts = String(folderPath || '').split('/').filter(Boolean);
  ensureRepoAndPath(token, parts, false, function (err, parentId) {
    if (err) return callback(null, null);
    findChildFile(token, parentId, filename, function (err, file) {
      if (err) return callback(null, null);
      return callback(null, file);
    });
  });
};

// filepath is "Fastack-<name>/2026/7/9" — everything up to and including the leaf filename.
// The leaf is created/updated with `fileContent` as text (JSON, base64, whatever the caller passes).
exports.createUpdateFile = function (token, filepath, fileContent, callback) {
  var parts = String(filepath || '').split('/').filter(Boolean);
  if (parts.length < 2) return callback(new Error('gdrive createUpdateFile: filepath must include repo folder + filename'), null);
  var filename = parts.pop();
  ensureRepoAndPath(token, parts, true, function (err, parentId) {
    if (err) return callback(err, null);
    findChildFile(token, parentId, filename, function (err, existing) {
      if (err) return callback(err, null);
      var boundary = '-------fastack' + Date.now();
      var metadata = existing
        ? { name: filename }
        : { name: filename, parents: [parentId], mimeType: 'application/json' };
      var body =
        '--' + boundary + '\r\n' +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify(metadata) + '\r\n' +
        '--' + boundary + '\r\n' +
        'Content-Type: application/json\r\n\r\n' +
        fileContent + '\r\n' +
        '--' + boundary + '--';
      var url = existing
        ? UPLOAD_API + '/files/' + existing.id + '?uploadType=multipart'
        : UPLOAD_API + '/files?uploadType=multipart';
      driveFetch(url, {
        method: existing ? 'PATCH' : 'POST',
        headers: authHeaders(token, { 'Content-Type': 'multipart/related; boundary=' + boundary }),
        body: body
      }, function (err, json) {
        if (err) return callback(err, null);
        return callback(null, 'Successfully wrote ' + filename);
      });
    });
  });
};
