// Push a Local Fastack stack (plus history) to a cloud backend.
// Iterates every snapshot in <userData>/fastack-local/<repoName>/ and rewrites it
// at the equivalent path on the target backend (Github / Dropbox / Google Drive).
//
// Usage:
//   migrate.pushLocalToCloud('Github', ghToken, 'my-username', 'my-repo', callback);
//   migrate.pushLocalToCloud('Dropbox', dbToken, null, 'work-stack', callback);
//   migrate.pushLocalToCloud('Google',  gToken, null, 'work-stack', callback);
//
// The target repo/folder is created if it doesn't already exist.

var async = require('async');
var localFunctions = require('./local_functions');
var githubFunctions = require('./github_functions');
var dropboxFunctions = require('./dropbox_functions');
var gdriveFunctions = require('./gdrive_functions');

function ensureCloudRepo(target, token, username, repoName, callback) {
  if (target === 'Github') {
    githubFunctions.checkFastackRepoExists(token, username, function (err, res) {
      if (err) return callback(err);
      if (res && res[0]) return callback(null, res[0]);
      githubFunctions.makeRepo(token, repoName, true, function (err) {
        if (err) return callback(err);
        // Drop the same marker file the login flow creates so future logins find it.
        githubFunctions.createUpdateFile(token, username, repoName, 'fastack-0-' + username, '', function (err) {
          if (err) return callback(err);
          return callback(null, repoName);
        });
      });
    });
  } else if (target === 'Dropbox') {
    dropboxFunctions.checkFastackRepoExists(token, function (err, existing) {
      if (err) return callback(err);
      if (existing) return callback(null, existing);
      dropboxFunctions.makeRepo(token, repoName, function (err) {
        if (err) return callback(err);
        return callback(null, 'Fastack-' + repoName);
      });
    });
  } else if (target === 'Google') {
    gdriveFunctions.checkFastackRepoExists(token, function (err, existing) {
      if (err) return callback(err);
      if (existing) return callback(null, existing);
      gdriveFunctions.makeRepo(token, repoName, function (err) {
        if (err) return callback(err);
        return callback(null, 'Fastack-' + repoName);
      });
    });
  } else {
    return callback(new Error('Unknown target platform: ' + target));
  }
}

function writeToCloud(target, token, username, cloudRepo, subPath, content, callback) {
  if (target === 'Github') {
    githubFunctions.createUpdateFile(token, username, cloudRepo, subPath, content, callback);
  } else if (target === 'Dropbox') {
    dropboxFunctions.createUpdateFile(token, cloudRepo + '/' + subPath, content, callback);
  } else if (target === 'Google') {
    gdriveFunctions.createUpdateFile(token, cloudRepo + '/' + subPath, content, callback);
  } else {
    return callback(new Error('Unknown target platform: ' + target));
  }
}

// options: { onProgress: fn(done, total, currentPath) }
exports.pushLocalToCloud = function (target, token, username, cloudRepoName, options, callback) {
  if (typeof options === 'function') { callback = options; options = {}; }
  options = options || {};
  var localRepoName = 'local';

  ensureCloudRepo(target, token, username, cloudRepoName, function (err, cloudRepo) {
    if (err) return callback(err);

    var snapshots = localFunctions.readAllSnapshots(localRepoName);
    var settings = localFunctions.readNamedFile(localRepoName, 'fastack_settings');
    var jobs = snapshots.slice();
    if (settings) jobs.push({ datePath: 'fastack_settings', content: settings });

    if (jobs.length === 0) {
      return callback(null, { cloudRepo: cloudRepo, uploaded: 0 });
    }

    var done = 0;
    async.eachSeries(jobs, function (job, next) {
      writeToCloud(target, token, username, cloudRepo, job.datePath, job.content, function (err) {
        done++;
        if (options.onProgress) options.onProgress(done, jobs.length, job.datePath);
        if (err) return next(err);
        return next();
      });
    }, function (err) {
      if (err) return callback(err);
      return callback(null, { cloudRepo: cloudRepo, uploaded: jobs.length });
    });
  });
};
