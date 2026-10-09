// Opt-in real-account smoke test. Credentials are read only from environment
// variables and never printed. Writes one harmless health-check file per backend.
const github = require('../helper/github_functions');
const dropbox = require('../helper/dropbox_functions');
const google = require('../helper/gdrive_functions');

function call(run) { return new Promise((resolve, reject) => run((err, value) => err ? reject(err) : resolve(value))); }
function required(name) { if (!process.env[name]) throw new Error('Missing ' + name); return process.env[name]; }

async function main() {
  const payload = JSON.stringify({ fastackHealthcheck: true, timestamp: new Date().toISOString() });
  const filename = '_fastack_healthcheck.json';

  const ghToken = required('FASTACK_GITHUB_TOKEN');
  const ghUser = required('FASTACK_GITHUB_USER');
  const ghRepo = required('FASTACK_GITHUB_REPO');
  await call(cb => github.createUpdateFile(ghToken, ghUser, ghRepo, filename, payload, cb));
  const ghResult = await call(cb => github.getContent(ghToken, ghUser, filename, ghRepo, cb));
  const ghText = Buffer.from((ghResult.content || '').replace(/\s/g, ''), 'base64').toString('utf8');
  if (JSON.parse(ghText).fastackHealthcheck !== true) throw new Error('GitHub round trip mismatch');

  const dbToken = required('FASTACK_DROPBOX_TOKEN');
  const dbRepo = required('FASTACK_DROPBOX_REPO');
  await call(cb => dropbox.createUpdateFile(dbToken, dbRepo + '/' + filename, payload, cb));
  const dbText = await call(cb => dropbox.getContent(dbToken, '/' + dbRepo + '/' + filename, cb));
  if (JSON.parse(dbText).fastackHealthcheck !== true) throw new Error('Dropbox round trip mismatch');

  const googleToken = required('FASTACK_GOOGLE_TOKEN');
  const googleRepo = required('FASTACK_GOOGLE_REPO');
  await call(cb => google.createUpdateFile(googleToken, googleRepo + '/' + filename, payload, cb));
  const googleText = await call(cb => google.getContent(googleToken, googleRepo + '/' + filename, cb));
  if (JSON.parse(googleText).fastackHealthcheck !== true) throw new Error('Google round trip mismatch');

  console.log('Live backend round trips passed: GitHub, Dropbox, Google Drive.');
}

main().catch(err => { console.error('Live backend smoke test failed:', err.message || err); process.exitCode = 1; });
