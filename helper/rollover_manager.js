// GitHub repository health guard. GitHub's 1 GB guidance is not a hard API
// limit, so use conservative thresholds before writes become unreliable.
var github = require('./github_functions');
var WARNING_KB = 1024 * 1024;
var BLOCK_KB = 5 * 1024 * 1024;

exports.checkGithub = function (token, username, repoName, callback) {
  github.getRepoInfo(token, username, repoName, function (err, info) {
    if (err || !info || typeof info.size !== 'number') return callback(null, { ok: true, warning: null });
    var sizeMb = Math.round(info.size / 1024);
    if (info.size >= BLOCK_KB) return callback(null, { ok: false, sizeMb: sizeMb, warning: 'GitHub repository is approximately ' + sizeMb + ' MB. Rollover is required before saving more tasks.' });
    if (info.size >= WARNING_KB) return callback(null, { ok: true, sizeMb: sizeMb, warning: 'GitHub repository is approximately ' + sizeMb + ' MB. Please roll over to a new repository soon.' });
    callback(null, { ok: true, warning: null, sizeMb: sizeMb });
  });
};

exports.thresholds = { warningMb: 1024, blockMb: 5120 };
