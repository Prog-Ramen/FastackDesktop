const test = require('node:test');
const assert = require('node:assert/strict');

function callbackResult(run) {
  return new Promise((resolve, reject) => run((err, value) => err ? reject(err) : resolve(value)));
}

test('GitHub creates a UTF-8-safe snapshot after checking for an existing file', async () => {
  const github = require('../helper/github_functions');
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (!options.method || options.method === 'GET') {
      return { status: 404, json: async () => ({ message: 'Not Found' }) };
    }
    return { status: 201, json: async () => ({ content: { path: '2026/8/31' } }) };
  };
  try {
    await callbackResult(cb => github.createUpdateFile('token', 'sam', 'tasks', '2026/8/31', '{"task":"café"}', cb));
    assert.equal(calls.length, 2);
    assert.match(calls[1].url, /repos\/sam\/tasks\/contents\/2026\/8\/31$/);
    const body = JSON.parse(calls[1].options.body);
    assert.equal(Buffer.from(body.content, 'base64').toString('utf8'), '{"task":"café"}');
  } finally { global.fetch = originalFetch; }
});

test('Dropbox supports current SDK result envelopes for listing and overwrites snapshots', async () => {
  const sdkPath = require.resolve('dropbox');
  const helperPath = require.resolve('../helper/dropbox_functions');
  const sdkModule = require.cache[sdkPath] || (require(sdkPath), require.cache[sdkPath]);
  const originalExports = sdkModule.exports;
  const calls = [];
  class FakeDropbox {
    filesListFolder(args) { calls.push(['list', args]); return Promise.resolve({ result: { entries: [{ name: '2026' }] } }); }
    filesUpload(args) { calls.push(['upload', args]); return Promise.resolve({ result: { name: '31' } }); }
    filesDownload(args) { calls.push(['download', args]); return Promise.resolve({ result: { fileBinary: Buffer.from('{"incomplete":[]}') } }); }
  }
  sdkModule.exports = { Dropbox: FakeDropbox };
  delete require.cache[helperPath];
  try {
    const dropbox = require('../helper/dropbox_functions');
    const entries = await callbackResult(cb => dropbox.listFiles('token', 'Fastack-tasks', cb));
    await callbackResult(cb => dropbox.createUpdateFile('token', 'Fastack-tasks/2026/8/31', '{}', cb));
    const content = await callbackResult(cb => dropbox.getContent('token', '/Fastack-tasks/2026/8/31', cb));
    assert.deepEqual(entries, [{ name: '2026' }]);
    assert.deepEqual(calls[1][1], { contents: '{}', path: '/Fastack-tasks/2026/8/31', mode: 'overwrite' });
    assert.equal(content, '{"incomplete":[]}');
  } finally {
    sdkModule.exports = originalExports;
    delete require.cache[helperPath];
  }
});

test('Google Drive updates an existing snapshot with multipart JSON', async () => {
  const drive = require('../helper/gdrive_functions');
  const originalFetch = global.fetch;
  let upload = null;
  global.fetch = async (url, options = {}) => {
    if (url.includes('/files?q=')) {
      const query = decodeURIComponent(url.split('q=')[1].split('&')[0]);
      const ids = { 'Fastack-tasks': 'repo', '2026': 'year', '8': 'month' };
      for (const [name, id] of Object.entries(ids)) if (query.includes("name = '" + name + "'")) return { status: 200, text: async () => JSON.stringify({ files: [{ id }] }) };
      if (query.includes("name = '31'")) return { status: 200, text: async () => JSON.stringify({ files: [{ id: 'snapshot', name: '31' }] }) };
    }
    if (url.includes('/upload/drive/v3/files/snapshot')) {
      upload = { url, options };
      return { status: 200, text: async () => JSON.stringify({ id: 'snapshot' }) };
    }
    throw new Error('Unexpected Drive request: ' + url);
  };
  try {
    await callbackResult(cb => drive.createUpdateFile('token', 'Fastack-tasks/2026/8/31', '{"incomplete":[]}', cb));
    assert.equal(upload.options.method, 'PATCH');
    assert.match(upload.options.headers['Content-Type'], /^multipart\/related/);
    assert.match(upload.options.body, /\{"incomplete":\[\]\}/);
  } finally { global.fetch = originalFetch; }
});

test('Google Drive reads a snapshot through resolved folder and file IDs', async () => {
  const drive = require('../helper/gdrive_functions');
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push(url);
    if (url.includes('/files?q=')) {
      const query = decodeURIComponent(url.split('q=')[1].split('&')[0]);
      if (query.includes("name = 'Fastack-tasks'")) return { status: 200, text: async () => JSON.stringify({ files: [{ id: 'repo' }] }) };
      if (query.includes("name = '2026'")) return { status: 200, text: async () => JSON.stringify({ files: [{ id: 'year' }] }) };
      if (query.includes("name = '8'")) return { status: 200, text: async () => JSON.stringify({ files: [{ id: 'month' }] }) };
      if (query.includes("name = '31'")) return { status: 200, text: async () => JSON.stringify({ files: [{ id: 'snapshot', name: '31' }] }) };
    }
    if (url.includes('/files/snapshot?alt=media')) return { status: 200, text: async () => '{"incomplete":[]}' };
    throw new Error('Unexpected Drive request: ' + url);
  };
  try {
    const content = await callbackResult(cb => drive.getContent('token', 'Fastack-tasks/2026/8/31', cb));
    assert.equal(content, '{"incomplete":[]}');
    assert.equal(calls.length, 5);
  } finally { global.fetch = originalFetch; }
});
