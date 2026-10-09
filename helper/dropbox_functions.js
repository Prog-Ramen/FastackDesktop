const base64 = require('base-64');
const algorithm = 'aes-256-ctr';
var async = require('async');
var GitHub = require('github-api');
var ls = require('local-storage');
var Repository = require('github-api/dist/components/Repository');
var client = null;
var temp = require('temp');
var fs = require('fs');
var Dropbox = require('dropbox');

temp.track();

exports.makeRepo = function (token, repoName, callback) {
  client = new Dropbox.Dropbox({
    accessToken: token
  });
  client.filesCreateFolderV2({ path: "/Fastack-" + repoName }).then((response) => {
    return callback(null, "success");
  }).catch((error) => {
    return callback(error, null);
  });
}

exports.getContent = function (token, filepath, callback) {
  client = new Dropbox.Dropbox({
    accessToken: token
  });
  client.filesDownload({ path: filepath }).then((response) => {
    console.log('[fastack] Dropbox download:', filepath);
    var payload = response.result || response;
    var binary = payload.fileBinary;
    if (!binary && payload.fileBlob && typeof payload.fileBlob.text === 'function') {
      return payload.fileBlob.text().then(function (text) { callback(null, text); });
    }
    if (binary && typeof binary !== 'string') {
      // Buffer or Uint8Array — decode to utf-8 so callers can JSON.parse directly.
      try {
        binary = Buffer.from(binary).toString('utf8');
      } catch (e) {
        // browser context: fall back to the Blob path
        if (payload.fileBlob && payload.fileBlob.text) {
          return payload.fileBlob.text().then(function (t) { callback(null, t); });
        }
      }
    }
    return callback(null, binary);
  }).catch((error) => {
    return callback(error, null);
  });
}

exports.listFiles = function (token, path, callback) {
  client = new Dropbox.Dropbox({
    accessToken: token
  });
  var normalizedPath = "/" + String(path || '').replace(/^\/+/, '').replace(/\/+$/, '');
  client.filesListFolder({ path: normalizedPath === '/' ? '' : normalizedPath }).then((response) => {
    var payload = response.result || response;
    console.log('[fastack] Dropbox list:', normalizedPath || '/', 'entries:', (payload.entries || []).length);
    return callback(null, payload.entries || []);
  }).catch((error) => {
    return callback(error, null);
  });
}

exports.checkFastackRepoExists = function (token, callback) {
  client = new Dropbox.Dropbox({
    accessToken: token
  });
  console.log(Object.getOwnPropertyNames(client));
  client.filesListFolder({ path: "" }).then((response) => {
    var payload = response.result || response;
    var folders = payload.entries || [];
    var repoName = "";
    if (!folders) {
      return callback(null, "");
    }
    
    folders.forEach(folder => {
      console.log(folder);
      if (folder.name.startsWith("Fastack-")) {
        repoName = folder.name;
      }
    });
    return callback(null, repoName);
  }).catch((error) => {
    return callback(error, null);
  });
}

exports.checkFileExists = function (token, folder, filename, callback) {
  var path = "/" + String(folder || '').replace(/^\/+/, '') + "/" + filename;
  this.getContent(token, path, function (err, content) {
    if (err) {
      return callback(null, null);
    }
    return callback(null, content);
  });
}

exports.createUpdateFile = function (token, filename, fileContent, callback) {
  client = new Dropbox.Dropbox({
    accessToken: token
  });
  var clean = String(filename || '').replace(/^\/+|\/+$/g, '');
  var segments = clean.split('/').filter(Boolean);
  var parent = '';
  var folders = segments.slice(0, -1).map(function (segment) {
    parent += '/' + segment;
    return parent;
  });
  // Dropbox's upload endpoint will not create missing parents. Build the
  // hierarchy serially; folder-exists errors are safe to ignore because the
  // target may already have been created by another snapshot.
  var ensure = Promise.resolve();
  if (typeof client.filesCreateFolderV2 === 'function') {
    folders.forEach(function (folderPath) {
      ensure = ensure.then(function () {
        return client.filesCreateFolderV2({ path: folderPath }).catch(function (error) {
          var summary = error && error.error && (error.error.error_summary || error.error['.tag']) || error && error.error_summary || '';
          // SDK versions wrap DropboxApiError differently; inspect the
          // normalized text as a final compatibility fallback.
          if (/conflict|already_exists|path[\\/]conflict/i.test(String(summary) + ' ' + String(error && error.message || '') + ' ' + JSON.stringify(error)) || error && error.status === 409) return null;
          throw error;
        });
      });
    });
  }
  var operation = ensure.then(function () {
    return client.filesUpload({ contents: fileContent, path: "/" + clean, mode: 'overwrite' });
  });
  var timeoutId;
  var timeout = new Promise(function (_, reject) { timeoutId = setTimeout(function () { reject(new Error('Dropbox upload timed out.')); }, 30000); });
  Promise.race([operation, timeout]).then(function () {
    clearTimeout(timeoutId);
    console.log('[fastack] Dropbox upload complete:', '/' + clean);
    return callback(null, "Successfully wrote " + filename);
  }).catch(function (error) {
    clearTimeout(timeoutId);
    console.error('[fastack] Dropbox upload failed:', filename, error && (error.error || error.message || error));
    return callback(error, null);
  });
};
