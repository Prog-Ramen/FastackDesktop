var ls = require('local-storage');
var KEY = 'fastackProfiles';
function profiles() { return ls(KEY) || {}; }
function profileKey(provider, account, repo) { return [provider || 'Local', account || 'default', repo || 'default'].join('|'); }
exports.key = profileKey;
exports.save = function (provider, account, repo, stack) {
  var all = profiles(); all[profileKey(provider, account, repo)] = { updatedAt: Date.now(), stack: stack }; ls(KEY, all);
};
exports.load = function (provider, account, repo) {
  var item = profiles()[profileKey(provider, account, repo)]; return item && item.stack || null;
};
exports.list = function () { return profiles(); };
exports.remove = function (key) {
  var all = profiles();
  if (!Object.prototype.hasOwnProperty.call(all, key)) return false;
  delete all[key];
  ls(KEY, all);
  return true;
};
exports.saveActive = function (stack) {
  var active = ls('activeWorkspace'), parts = active ? active.split('|') : null;
  return exports.save(parts ? parts[0] : ls('platform'), parts ? parts[1] : ls('username'), parts ? parts[2] : ls('repoName'), stack);
};
