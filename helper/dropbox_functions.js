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
    var payload = response.result || response;
    var binary = payload.fileBinary;
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
  client.filesListFolder({ path: "/" + path }).then((response) => {
    return callback(null, response.entries);
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
    var folders = response.result.entries;
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
  client.filesUpload({ contents: fileContent, path: "/" + filename, mode: 'overwrite' }).then((response) => {
    return callback(null, "Successfully wrote " + filename);
  }).catch((error) => {
    return callback(error, null);
  });
};
