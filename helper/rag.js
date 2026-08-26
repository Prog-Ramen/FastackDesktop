// Local RAG pipeline.
//
// Uses @xenova/transformers with Xenova/all-MiniLM-L6-v2 (384-dim) to embed
// text chunks locally — no API calls, no data leaves the machine. Index lives
// under <userData>/fastack-rag/<hash>/index.json where <hash> is derived from
// the folder path so re-indexing the same folder overwrites in place.
//
// Public API:
//   indexFolder(dir, onProgress, callback) -> callback(err, {chunks, files})
//   search(query, k, callback)             -> callback(err, [{score, path, chunk, offset}])
//   getActive()                            -> { folder, hash, updatedAt } | null
//   setActive(folder, hash)
//   clear()
//
// 1. Force Node 16's internal web streams onto the global scope
//

// At the top of helper/rag.js (Keep your polyfills here)
let pipeline = null;
let env = null;

// Helper to ensure transformers is loaded before running any RAG tasks
async function initTransformers() {
  if (pipeline && env) return; // Already loaded

  // Dynamically import the ES Module
  const transformers = await import('@xenova/transformers');

  pipeline = transformers.pipeline;
  env = transformers.env;

  // Apply your settings safely after import
  env.allowLocalModels = true;
}

try {
  if (typeof globalThis.ReadableStream === 'undefined') {
    const { ReadableStream, TransformStream, WritableStream } = require('node:stream/web');
    globalThis.ReadableStream = ReadableStream;
    globalThis.TransformStream = TransformStream;
    globalThis.WritableStream = WritableStream;
  }
} catch (e) {
  console.log('[fastack] Failed to polyfill web streams:', e.message);
}

// 2. NOW it is safe to require undici
try {
  const undici = require('undici');
  if (typeof globalThis.fetch === 'undefined') globalThis.fetch = undici.fetch;
  if (typeof globalThis.Headers === 'undefined') globalThis.Headers = undici.Headers;
  if (typeof globalThis.Request === 'undefined') globalThis.Request = undici.Request;
  if (typeof globalThis.Response === 'undefined') globalThis.Response = undici.Response;
  if (typeof globalThis.FormData === 'undefined') globalThis.FormData = undici.FormData;
} catch (e) {
  console.log('[fastack] undici polyfill unavailable:', e.message);
}


var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

// Resolve userData whether we're running in main or renderer. In main,
// electron.app.getPath works directly; in a renderer we ask via @electron/remote.
function getUserDataPath() {
  try {
    var electron = require('electron');
    if (electron && electron.app && typeof electron.app.getPath === 'function') {
      return electron.app.getPath('userData');
    }
  } catch (e) { /* fall through */ }
  var remote = require('@electron/remote');
  return remote.app.getPath('userData');
}

var TEXT_EXTENSIONS = new Set([
  '.md', '.markdown', '.txt', '.rst',
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift',
  '.c', '.h', '.cpp', '.hpp', '.cc', '.m',
  '.cs', '.php', '.sh', '.zsh', '.bash',
  '.html', '.htm', '.css', '.scss', '.less',
  '.json', '.yaml', '.yml', '.toml', '.xml',
  '.sql', '.graphql', '.gql'
]);
var SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.venv', 'venv', '__pycache__', '.next', 'out', 'target', 'coverage', '.cache', '.turbo']);
var MAX_FILE_BYTES = 200 * 1024;   // Skip anything over 200KB — likely generated / not doc-y.
var CHUNK_SIZE = 500;
var CHUNK_OVERLAP = 50;

// -------------------- storage helpers --------------------

function ragRoot() {
  var root = path.join(getUserDataPath(), 'fastack-rag');
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  return root;
}

function hashFolder(folder) {
  return crypto.createHash('sha1').update(folder).digest('hex').slice(0, 12);
}

function activeFile() { return path.join(ragRoot(), 'active.json'); }
function indexDir(hash) { return path.join(ragRoot(), hash); }
function indexFile(hash) { return path.join(indexDir(hash), 'index.json'); }
function metaFile(hash) { return path.join(indexDir(hash), 'meta.json'); }

exports.getActive = function () {
  var f = activeFile();
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; }
};

exports.setActive = function (folder, hash) {
  fs.writeFileSync(activeFile(), JSON.stringify({ folder: folder, hash: hash, updatedAt: Date.now() }), 'utf8');
};

exports.clear = function () {
  var a = exports.getActive();
  if (a && a.hash) {
    var d = indexDir(a.hash);
    if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
  }
  if (fs.existsSync(activeFile())) fs.unlinkSync(activeFile());
};

// -------------------- walker + chunker --------------------

function walk(dir, out) {
  var entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (e) { return; }
  entries.forEach(function (ent) {
    if (ent.name.startsWith('.') && ent.name !== '.env.example') return;
    if (SKIP_DIRS.has(ent.name)) return;
    var full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walk(full, out);
    } else if (ent.isFile()) {
      var ext = path.extname(ent.name).toLowerCase();
      if (!TEXT_EXTENSIONS.has(ext)) return;
      try {
        var st = fs.statSync(full);
        if (st.size > MAX_FILE_BYTES) return;
      } catch (e) { return; }
      out.push(full);
    }
  });
}

function chunkText(text) {
  var chunks = [];
  var i = 0;
  var n = text.length;
  while (i < n) {
    var end = Math.min(i + CHUNK_SIZE, n);
    // Prefer cutting on a newline/space boundary if we're not at end.
    if (end < n) {
      var lastNl = text.lastIndexOf('\n', end);
      var lastSp = text.lastIndexOf(' ', end);
      var cut = Math.max(lastNl, lastSp);
      if (cut > i + CHUNK_SIZE * 0.5) end = cut;
    }
    var chunk = text.slice(i, end).trim();
    if (chunk.length >= 20) chunks.push({ offset: i, chunk: chunk });
    if (end >= n) break;
    i = end - CHUNK_OVERLAP;
    if (i < 0) i = 0;
  }
  return chunks;
}

// -------------------- AST-based code chunker (JS/TS) --------------------
//
// Naive fixed-window chunking splits functions in half and loses semantic
// boundaries. For JS/TS we parse with @babel/parser and emit one chunk per
// top-level function/method/class, tagged with the callees it invokes. At
// search time we can then pull in the *definitions of those callees* to give
// the LLM the full call graph around a match — much richer than a random
// 500-char window.
var CODE_EXTS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx']);

function isCodeFile(fp) {
  return CODE_EXTS.has(path.extname(fp).toLowerCase());
}

function nodeName(node) {
  if (!node) return null;
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression') {
    var obj = nodeName(node.object);
    var prop = node.property && node.property.name;
    return obj && prop ? obj + '.' + prop : (prop || obj);
  }
  return null;
}

// Walk an AST manually to avoid pulling in @babel/traverse.
function astWalk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach(function (n) { astWalk(n, visit); }); return; }
  if (!node.type) return;
  var cont = visit(node);
  if (cont === false) return;
  for (var key in node) {
    if (key === 'loc' || key === 'range' || key === 'start' || key === 'end' || key === 'leadingComments' || key === 'trailingComments') continue;
    var child = node[key];
    if (child && typeof child === 'object') astWalk(child, visit);
  }
}

function collectCallees(bodyNode) {
  var callees = [];
  var seen = new Set();
  astWalk(bodyNode, function (n) {
    if (n.type === 'CallExpression' || n.type === 'NewExpression') {
      var name = nodeName(n.callee);
      if (name && !seen.has(name)) { seen.add(name); callees.push(name); }
    }
  });
  return callees;
}

function chunkCode(text, filePath) {
  var parser;
  try { parser = require('@babel/parser'); }
  catch (e) { return chunkText(text); }
  var ast;
  try {
    ast = parser.parse(text, {
      sourceType: 'unambiguous',
      allowReturnOutsideFunction: true,
      allowImportExportEverywhere: true,
      errorRecovery: true,
      plugins: ['typescript', 'jsx', 'classProperties', 'decorators-legacy', 'objectRestSpread', 'optionalChaining', 'nullishCoalescingOperator', 'topLevelAwait']
    });
  } catch (e) {
    return chunkText(text);
  }

  var out = [];
  function push(kind, symbol, node) {
    if (!node || typeof node.start !== 'number' || typeof node.end !== 'number') return;
    var src = text.slice(node.start, node.end);
    if (src.length < 20) return;
    // Prepend a header line so the embedding vector reflects the symbol name.
    var header = '// ' + kind + ' ' + (symbol || '(anon)') + '\n';
    out.push({
      offset: node.start,
      symbol: symbol || null,
      kind: kind,
      chunk: (header + src).slice(0, 2000),
      callees: collectCallees(node)
    });
  }

  var body = (ast.program && ast.program.body) || ast.body || [];
  body.forEach(function (stmt) {
    if (!stmt) return;
    switch (stmt.type) {
      case 'FunctionDeclaration':
        push('function', stmt.id && stmt.id.name, stmt);
        break;
      case 'ClassDeclaration':
        push('class', stmt.id && stmt.id.name, stmt);
        if (stmt.body && stmt.body.body) {
          stmt.body.body.forEach(function (m) {
            if (m.type === 'ClassMethod' || m.type === 'MethodDefinition') {
              var mname = (m.key && (m.key.name || m.key.value)) || 'method';
              push('method', (stmt.id ? stmt.id.name + '.' : '') + mname, m);
            }
          });
        }
        break;
      case 'ExportNamedDeclaration':
      case 'ExportDefaultDeclaration':
        if (stmt.declaration) {
          var d = stmt.declaration;
          if (d.type === 'FunctionDeclaration') push('function', d.id && d.id.name, d);
          else if (d.type === 'ClassDeclaration') push('class', d.id && d.id.name, d);
          else if (d.type === 'VariableDeclaration') {
            d.declarations.forEach(function (v) {
              if (v.init && (v.init.type === 'ArrowFunctionExpression' || v.init.type === 'FunctionExpression')) {
                push('function', v.id && v.id.name, v);
              }
            });
          }
        }
        break;
      case 'VariableDeclaration':
        stmt.declarations.forEach(function (v) {
          if (v.init && (v.init.type === 'ArrowFunctionExpression' || v.init.type === 'FunctionExpression')) {
            push('function', v.id && v.id.name, v);
          }
        });
        break;
      case 'ExpressionStatement':
        // module.exports.foo = function(...) or exports.foo = ...
        var expr = stmt.expression;
        if (expr && expr.type === 'AssignmentExpression' && expr.right &&
            (expr.right.type === 'FunctionExpression' || expr.right.type === 'ArrowFunctionExpression')) {
          push('function', nodeName(expr.left), stmt);
        }
        break;
      default: break;
    }
  });

  // Fallback: if AST-based chunking yielded nothing (e.g., file is pure config),
  // use naive chunking so we don't lose the file entirely.
  if (!out.length) return chunkText(text);
  return out;
}

function chunkFile(text, filePath) {
  return isCodeFile(filePath) ? chunkCode(text, filePath) : chunkText(text);
}

// -------------------- embedder (cached pipeline) --------------------

// Pre-download the model files with raw Node https, dodging undici's fetch
// entirely. In Electron 19's Node 16, undici + transformers.js' redirect path
// dies with "terminated (cause: stream.on is not a function)". Once the files
// are on disk, transformers.js reads them from the FileCache and never touches
// the network.
var MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
var MODEL_FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'onnx/model_quantized.onnx'
];

// Chat model for generating task descriptions/plans. ~1.88GB one-time download
// (the ONNX file is 1.87GB of that). Prompted with ChatML via the tokenizer's
// chat template. The 0.5B variant produced garbage, so we use the 1.8B — still
// a small model but notably better at following instructions.
var GEN_MODEL_ID = 'Xenova/Qwen1.5-1.8B-Chat';
var GEN_MODEL_FILES = [
  'config.json',
  'generation_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'special_tokens_map.json',
  'added_tokens.json',
  'vocab.json',
  'merges.txt',
  'onnx/decoder_model_merged_quantized.onnx'
];

function httpsGet(url, destPath) {
  return new Promise(function (resolve, reject) {
    var https = require('https');
    var lib = url.startsWith('https:') ? https : require('http');
    var req = lib.get(url, { headers: { 'User-Agent': 'fastack/1.0' } }, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        var next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).toString();
        res.resume();
        resolve(httpsGet(next, destPath));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode + ' for ' + url));
      }
      var tmp = destPath + '.part';
      var out = fs.createWriteStream(tmp);
      res.pipe(out);
      out.on('finish', function () {
        out.close(function () {
          try { fs.renameSync(tmp, destPath); resolve(); }
          catch (e) { reject(e); }
        });
      });
      out.on('error', reject);
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(300_000, function () { req.destroy(new Error('timeout')); });
  });
}

async function ensureFilesCached(cacheDir, modelId, files, onProgress) {
  onProgress = onProgress || function () {};
  var missing = [];
  for (var i = 0; i < files.length; i++) {
    var rel = files[i];
    var target = path.join(cacheDir, modelId, rel);
    if (!fs.existsSync(target) || fs.statSync(target).size === 0) missing.push(rel);
  }
  if (!missing.length) return;
  for (var j = 0; j < missing.length; j++) {
    var rel2 = missing[j];
    var target2 = path.join(cacheDir, modelId, rel2);
    try { fs.mkdirSync(path.dirname(target2), { recursive: true }); } catch (e) {}
    var url = 'https://huggingface.co/' + modelId + '/resolve/main/' + rel2;
    console.log('[fastack] downloading', rel2);
    onProgress({ phase: 'downloading', file: rel2, done: j, total: missing.length });
    var lastErr;
    for (var attempt = 0; attempt < 3; attempt++) {
      try { await httpsGet(url, target2); lastErr = null; break; }
      catch (e) {
        lastErr = e;
        console.log('[fastack] download failed (attempt %d): %s', attempt + 1, e.message);
        await new Promise(function (r) { setTimeout(r, 1000 * (attempt + 1)); });
      }
    }
    if (lastErr) throw lastErr;
  }
}

// Kept for backwards compat with the embedder loader.
async function ensureModelFilesCached(cacheDir) {
  return ensureFilesCached(cacheDir, MODEL_ID, MODEL_FILES);
}

var cachedEmbedder = null;      // resolved pipeline (never a rejected promise)
var embedderPromise = null;     // in-flight load

function isTransientNetErr(e) {
  var msg = (e && (e.message || String(e))) || '';
  var causeMsg = (e && e.cause && (e.cause.message || String(e.cause))) || '';
  return /terminated|fetch failed|socket|ECONN|ETIMEDOUT|UND_ERR/i.test(msg + ' ' + causeMsg);
}

async function loadPipelineOnce() {
  var mod = await import('@xenova/transformers');
  var cacheDir = path.join(getUserDataPath(), 'fastack-rag', 'models');
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
  // Pre-warm the FileCache with raw https so transformers.js never has to fetch.
  await ensureModelFilesCached(cacheDir);
  if (mod.env) {
    mod.env.allowLocalModels = false;
    mod.env.cacheDir = cacheDir;
  }
  return await mod.pipeline('feature-extraction', MODEL_ID);
}

async function getEmbedder() {
  if (cachedEmbedder) return cachedEmbedder;
  if (embedderPromise) return embedderPromise;
  embedderPromise = (async function () {
    var lastErr;
    for (var attempt = 0; attempt < 3; attempt++) {
      try {
        var pipe = await loadPipelineOnce();
        cachedEmbedder = pipe;
        return pipe;
      } catch (e) {
        lastErr = e;
        if (!isTransientNetErr(e)) throw e;
        console.log('[fastack] pipeline load transient failure (attempt %d): %s', attempt + 1, e.message);
        await new Promise(function (r) { setTimeout(r, 1000 * (attempt + 1)); });
      }
    }
    throw lastErr || new Error('pipeline load failed');
  })().catch(function (err) {
    embedderPromise = null;  // allow the next call to retry from scratch
    throw err;
  });
  return embedderPromise;
}

async function embed(texts) {
  var pipe = await getEmbedder();
  var lastErr;
  for (var attempt = 0; attempt < 2; attempt++) {
    try {
      var out = await pipe(texts, { pooling: 'mean', normalize: true });
      var dims = out.dims || [texts.length, 384];
      var d = dims[1];
      var flat = Array.from(out.data);
      var vecs = [];
      for (var i = 0; i < texts.length; i++) {
        vecs.push(flat.slice(i * d, (i + 1) * d));
      }
      return vecs;
    } catch (e) {
      lastErr = e;
      if (!isTransientNetErr(e)) throw e;
      await new Promise(function (r) { setTimeout(r, 500); });
    }
  }
  throw lastErr || new Error('embed failed');
}

// -------------------- generator (forked child process) --------------------
//
// The generator lives in a child process so 1.8B-parameter inference doesn't
// freeze the popup UI. Main pre-downloads all model files (using its raw-https
// path that dodges the Electron/undici stream bug), then forks gen_worker.js
// which loads them from disk and serves generate() requests over IPC.

// Global genState shared between the fork loader and renderer sync queries.
// Listeners can subscribe via onGenState() to be notified on updates.
var genState = { phase: 'idle' };
var genStateListeners = [];
function setGenState(next) {
  genState = Object.assign({}, genState, next);
  genStateListeners.forEach(function (fn) { try { fn(genState); } catch (e) {} });
}
function onGenState(fn) { if (typeof fn === 'function') genStateListeners.push(fn); }

var childProc = require('child_process');

var genFork = null;
var genForkReady = false;
var genForkReadyPromise = null;      // resolves once fork sends 'ready'
var genPending = new Map();          // requestId -> {resolve, reject, onProgress}
var genRequestId = 0;

function killGenFork() {
  if (!genFork) return;
  try { genFork.removeAllListeners(); } catch (e) {}
  try { genFork.kill(); } catch (e) {}
  genFork = null;
  genForkReady = false;
  genForkReadyPromise = null;
}

function spawnGenFork(cacheDir) {
  if (genFork) return;
  genFork = childProc.fork(path.join(__dirname, 'gen_worker.js'), [], {
    // ELECTRON_RUN_AS_NODE tells Electron to behave like plain node — required
    // when the parent was launched as Electron (all our runtime invocations).
    env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' }),
    stdio: ['pipe', 'pipe', 'pipe', 'ipc']
  });
  if (genFork.stdout) genFork.stdout.on('data', function (b) { process.stdout.write('[gen] ' + b); });
  if (genFork.stderr) genFork.stderr.on('data', function (b) { process.stderr.write('[gen] ' + b); });
  genFork.on('exit', function (code, signal) {
    console.log('[fastack] gen worker exited code=%s signal=%s', code, signal);
    // Fail any in-flight requests so callers don't hang.
    genPending.forEach(function (r) { try { r.reject(new Error('gen worker exited')); } catch (e) {} });
    genPending.clear();
    genFork = null;
    genForkReady = false;
    genForkReadyPromise = null;
  });
  genFork.on('message', function (msg) {
    if (!msg || !msg.type) return;
    if (msg.type === 'ready') {
      genForkReady = true;
      setGenState({ phase: 'ready' });
    } else if (msg.type === 'progress') {
      // Route progress: request-scoped goes to the pending waiter's onProgress,
      // otherwise it's a global state event (loading, etc).
      if (msg.id != null && genPending.has(msg.id)) {
        try { genPending.get(msg.id).onProgress(msg); } catch (e) {}
      } else {
        setGenState(msg);
      }
    } else if (msg.type === 'result') {
      var req = genPending.get(msg.id);
      if (req) { genPending.delete(msg.id); req.resolve({ text: msg.text || '' }); }
    } else if (msg.type === 'error') {
      if (msg.id != null && genPending.has(msg.id)) {
        var r = genPending.get(msg.id);
        genPending.delete(msg.id);
        r.reject(new Error(msg.error || 'gen worker error'));
      } else {
        console.log('[fastack] gen worker error:', msg.error);
      }
    }
  });
}

async function ensureGenFork() {
  if (genForkReady && genFork) return;
  if (genForkReadyPromise) return genForkReadyPromise;
  genForkReadyPromise = (async function () {
    var cacheDir = path.join(getUserDataPath(), 'fastack-rag', 'models');
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
    // Main downloads (raw https, resilient) — the worker only reads from disk.
    await ensureFilesCached(cacheDir, GEN_MODEL_ID, GEN_MODEL_FILES, function (p) {
      setGenState(p);
    });
    spawnGenFork(cacheDir);
    setGenState({ phase: 'loading' });
    // Kick off load in the worker and wait for its 'ready' reply.
    await new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { reject(new Error('gen worker load timeout')); }, 180_000);
      var poll = setInterval(function () {
        if (genForkReady) { clearInterval(poll); clearTimeout(timer); resolve(); }
      }, 200);
      try {
        genFork.send({ type: 'load', cacheDir: cacheDir, modelId: GEN_MODEL_ID });
      } catch (e) { clearInterval(poll); clearTimeout(timer); reject(e); }
    });
  })().catch(function (err) {
    killGenFork();
    throw err;
  });
  return genForkReadyPromise;
}

// Public: generate content for either 'notes' (markdown, longer) or
// 'description' (plain-text summary of an existing notes body). If contextText
// is provided (for description mode we pass the notes body directly), it's
// used verbatim.
exports.generate = async function (opts, callback) {
  var cb = callback || function () {};
  var onProgress = (opts && opts.onProgress) || function () {};
  var title = opts && opts.title;
  var mode = (opts && opts.mode) || 'notes';
  var notesBody = opts && opts.notesBody;
  var contextChunks = opts && opts.contextChunks;
  if (!title || !title.trim()) return cb(new Error('title required'));

  try {
    await ensureGenFork();

    var contextText = '';
    if (Array.isArray(contextChunks) && contextChunks.length) {
      contextText = '\n\nRelated snippets from the user’s docs:\n';
      contextChunks.slice(0, 5).forEach(function (c, i) {
        var snippet = String(c.chunk || '').slice(0, 500);
        var tag = '[' + (c.path || 'doc');
        if (c.symbol) tag += ' · ' + (c.kind || 'symbol') + ' ' + c.symbol;
        if (c.via) tag += ' · via ' + c.via;
        tag += ']';
        contextText += (i + 1) + '. ' + tag + '\n' + snippet;
        if (c.callees && c.callees.length) {
          contextText += '\n   calls: ' + c.callees.slice(0, 6).join(', ');
        }
        contextText += '\n\n';
      });
    }

    var messages, maxNew, repPenalty;
    if (mode === 'description') {
      // Summarize existing notes into a plain-text 1-2 sentence description.
      messages = [
        { role: 'system', content: 'You are a concise productivity assistant. Summarize the notes below into a 1-2 sentence plain-text description of the task. No lists, no headers, no markdown. Return only the summary sentence(s).' },
        { role: 'user', content: 'Task title: "' + title.trim() + '"\n\nNotes:\n' + (notesBody || '') }
      ];
      maxNew = 200;
      repPenalty = 1.1;
    } else {
      // Full notes body: allow markdown, encourage detail.
      messages = [
        { role: 'system', content:
          'You are a productivity assistant. Given a task title (and optional related context), write comprehensive notes for the task in Markdown. Include:\n' +
          '1. An **Overview** paragraph (3-5 sentences) explaining what the task involves and why it matters.\n' +
          '2. An **Approach** section with a numbered plan of 5-8 concrete steps. Each step should be a full sentence.\n' +
          '3. A **Considerations** section with 3-5 bullets covering edge cases, risks, or dependencies.\n' +
          '4. A **Definition of done** section with 2-3 checkable criteria.\n' +
          'Be thorough. Do NOT stop early. Continue writing until all four sections above are complete.'
        },
        { role: 'user', content: 'Task title: "' + title.trim() + '"' + contextText }
      ];
      maxNew = 1400;
      // Lower repetition penalty so the model doesn't emit end-of-turn early
      // just to avoid overlapping phrasing across sections.
      repPenalty = 1.03;
    }

    var id = ++genRequestId;
    onProgress({ phase: 'generating' });

    var result = await new Promise(function (resolve, reject) {
      genPending.set(id, { resolve: resolve, reject: reject, onProgress: onProgress });
      try {
        genFork.send({
          type: 'generate',
          id: id,
          messages: messages,
          opts: {
            max_new_tokens: maxNew,
            temperature: mode === 'description' ? 0.4 : 0.7,
            top_p: 0.9,
            do_sample: true,
            repetition_penalty: repPenalty
          }
        });
      } catch (e) {
        genPending.delete(id);
        reject(e);
      }
    });

    onProgress({ phase: 'done' });
    cb(null, { text: (result && result.text || '').trim() });
  } catch (e) {
    cb(e);
  }
};

//async function embed(texts) {
//  var pipe = await getEmbedder();
//  var out = await pipe(texts, { pooling: 'mean', normalize: true });
  // out is a Tensor of shape [N, 384]. Convert to plain JS arrays.
//  var dims = out.dims || [texts.length, 384];
//  var flat = Array.from(out.data);
//  var d = dims[1];
//  var vecs = [];
//  for (var i = 0; i < texts.length; i++) {
//    vecs.push(flat.slice(i * d, (i + 1) * d));
//  }
//  return vecs;
//}

// -------------------- public API --------------------
exports.indexFolder = async function (folder, onProgress, callback) {
  var cb = callback || function () { };
  onProgress = onProgress || function () { };
  if (!folder || !fs.existsSync(folder)) return cb(new Error('Folder does not exist'));

  try {
    onProgress({ phase: 'scanning' });
    var files = [];
    walk(folder, files);
    if (!files.length) return cb(new Error('No indexable files found'));

    onProgress({ phase: 'chunking', files: files.length });
    var records = [];
    files.forEach(function (fp, idx) {
      var text;
      try { text = fs.readFileSync(fp, 'utf8'); } catch (e) { return; }
      var rel = path.relative(folder, fp);
      chunkFile(text, fp).forEach(function (c) {
        records.push({
          path: rel,
          offset: c.offset,
          chunk: c.chunk,
          symbol: c.symbol || null,
          kind: c.kind || null,
          callees: c.callees || []
        });
      });
      if (idx > 0 && idx % 20 === 0) onProgress({ phase: 'chunking', files: files.length, done: idx });
    });

    if (!records.length) return cb(new Error('No non-trivial chunks found'));

    onProgress({ phase: 'embedding', chunks: records.length });
    var BATCH = 16;
    for (var b = 0; b < records.length; b += BATCH) {
      var slice = records.slice(b, b + BATCH);
      var vecs = await embed(slice.map(function (r) { return r.chunk; }));
      vecs.forEach(function (v, j) { slice[j].embedding = v; });
      onProgress({ phase: 'embedding', chunks: records.length, done: Math.min(b + BATCH, records.length) });
    }

    var hash = hashFolder(folder);
    var dir = indexDir(hash);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(indexFile(hash), JSON.stringify(records), 'utf8');
    fs.writeFileSync(metaFile(hash), JSON.stringify({
      folder: folder, files: files.length, chunks: records.length, updatedAt: Date.now()
    }), 'utf8');
    exports.setActive(folder, hash);
    loadedIndexHash = hash;
    loadedIndex = records;

    onProgress({ phase: 'done', chunks: records.length, files: files.length });
    cb(null, { chunks: records.length, files: files.length });
  } catch (e) {
    cb(e);
  }
};

//exports.indexFolder = async function (folder, onProgress, callback) {
//  var cb = callback || function () { };
//  onProgress = onProgress || function () { };
//  if (!folder || !fs.existsSync(folder)) return cb(new Error('Folder does not exist'));
//  try {
//    onProgress({ phase: 'scanning' });
//    var files = [];
//    walk(folder, files);
//    if (!files.length) return cb(new Error('No indexable files found (checked ' + TEXT_EXTENSIONS.size + ' extensions)'));
//
//    onProgress({ phase: 'chunking', files: files.length });
//    var records = [];
//    files.forEach(function (fp, idx) {
//      var text;
//      try { text = fs.readFileSync(fp, 'utf8'); } catch (e) { return; }
//      var rel = path.relative(folder, fp);
//      chunkText(text).forEach(function (c) {
//        records.push({ path: rel, offset: c.offset, chunk: c.chunk });
//      });
//      if (idx % 20 === 0) onProgress({ phase: 'chunking', files: files.length, done: idx });
//    });
//
//    if (!records.length) return cb(new Error('No non-trivial chunks found'));
//
//    onProgress({ phase: 'embedding', chunks: records.length });
//    var BATCH = 16;
//    for (var b = 0; b < records.length; b += BATCH) {
//      var slice = records.slice(b, b + BATCH);
//      var vecs = await embed(slice.map(function (r) { return r.chunk; }));
//      vecs.forEach(function (v, j) { slice[j].embedding = v; });
//      onProgress({ phase: 'embedding', chunks: records.length, done: Math.min(b + BATCH, records.length) });
//    }
//
//    var hash = hashFolder(folder);
//    var dir = indexDir(hash);
//    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
//    fs.writeFileSync(indexFile(hash), JSON.stringify(records), 'utf8');
//    fs.writeFileSync(metaFile(hash), JSON.stringify({
//      folder: folder, files: files.length, chunks: records.length, updatedAt: Date.now()
//    }), 'utf8');
//    exports.setActive(folder, hash);
//
//    onProgress({ phase: 'done', chunks: records.length, files: files.length });
//    cb(null, { chunks: records.length, files: files.length });
//  } catch (e) {
//    cb(e);
//  }
//};

function cosine(a, b) {
  var dot = 0;
  for (var i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // vectors are already normalized by the pipeline (normalize: true)
}

var loadedIndexHash = null;
var loadedIndex = null;
var loadedSymbolIndex = null;   // symbol -> [chunk records that DEFINE it]
var loadedCallerIndex = null;   // symbol -> [chunk records that CALL it]

function buildSymbolIndex(records) {
  var byDef = Object.create(null);
  var byCall = Object.create(null);
  records.forEach(function (r) {
    // Definitions (both full "Class.method" and short "method" forms)
    if (r.symbol) {
      var short = String(r.symbol).split('.').pop();
      (byDef[r.symbol] = byDef[r.symbol] || []).push(r);
      if (short !== r.symbol) (byDef[short] = byDef[short] || []).push(r);
    }
    // Reverse: for each callee this chunk invokes, record this chunk as a caller.
    (r.callees || []).forEach(function (cname) {
      (byCall[cname] = byCall[cname] || []).push(r);
      var short2 = String(cname).split('.').pop();
      if (short2 !== cname) (byCall[short2] = byCall[short2] || []).push(r);
    });
  });
  return { byDef: byDef, byCall: byCall };
}

function loadIndex(hash) {
  if (loadedIndexHash === hash && loadedIndex) return loadedIndex;
  if (!fs.existsSync(indexFile(hash))) return null;
  try {
    loadedIndex = JSON.parse(fs.readFileSync(indexFile(hash), 'utf8'));
    loadedIndexHash = hash;
    var idx = buildSymbolIndex(loadedIndex);
    loadedSymbolIndex = idx.byDef;
    loadedCallerIndex = idx.byCall;
    return loadedIndex;
  } catch (e) { return null; }
}

exports.search = async function (query, k, callback) {
  var cb = callback || function () { };
  var active = exports.getActive();
  if (!active) return cb(null, []);
  var index = loadIndex(active.hash);
  if (!index || !index.length) return cb(null, []);
  if (!query || !query.trim()) return cb(null, []);
  try {
    var vecs = await embed([query]);
    var q = vecs[0];
    var scored = index.map(function (r, i) {
      return {
        _i: i, score: cosine(q, r.embedding),
        path: r.path, chunk: r.chunk, offset: r.offset,
        symbol: r.symbol || null, kind: r.kind || null, callees: r.callees || []
      };
    });
    scored.sort(function (a, b) { return b.score - a.score; });
    var kOut = k || 5;
    var topK = scored.slice(0, kOut);

    // ---- Call-graph expansion ----
    // Downward: BFS through callees up to 2 hops (foo -> bar -> baz).
    // Upward:   1 hop through callers   (who calls foo? include them).
    // Deduped via `picked` so nothing appears twice. Total expansions capped
    // at MAX_EXPANSIONS to keep the LLM prompt below ~6-8 chunks worth of code.
    var MAX_EXPANSIONS = 6;
    var picked = Object.create(null);
    topK.forEach(function (r) { picked[r._i] = true; });
    var expansions = [];

    function tryAdd(def, viaLabel, hop, direction, parentScore) {
      if (!def || expansions.length >= MAX_EXPANSIONS) return null;
      var idx = index.indexOf(def);
      if (idx < 0 || picked[idx]) return null;
      picked[idx] = true;
      // Decay score by hop distance so direct hits still rank above graph hops.
      var decay = direction === 'up' ? 0.6 : (hop === 1 ? 0.7 : 0.5);
      var rec = {
        _i: idx,
        score: parentScore * decay,
        path: def.path, chunk: def.chunk, offset: def.offset,
        symbol: def.symbol || null, kind: def.kind || null,
        callees: def.callees || [],
        via: viaLabel,
        hop: hop,
        direction: direction
      };
      expansions.push(rec);
      return rec;
    }

    // Downward BFS across all top-K matches.
    var frontier = topK.map(function (r) { return { rec: r, hop: 0 }; });
    while (frontier.length && expansions.length < MAX_EXPANSIONS) {
      var next = [];
      for (var i = 0; i < frontier.length; i++) {
        var f = frontier[i];
        if (f.hop >= 2) continue;   // depth cap
        var callees = (f.rec.callees || []).slice(0, 3);
        for (var c = 0; c < callees.length && expansions.length < MAX_EXPANSIONS; c++) {
          var defs = loadedSymbolIndex && loadedSymbolIndex[callees[c]];
          if (!defs || !defs.length) continue;
          var added = tryAdd(defs[0], (f.rec.symbol || f.rec.path) + ' → ' + callees[c],
                             f.hop + 1, 'down', f.rec.score);
          if (added) next.push({ rec: added, hop: f.hop + 1 });
        }
      }
      frontier = next;
    }

    // Upward BFS: who calls this function, and who calls THEM. Same depth cap
    // as downward so both directions of the call graph get equal representation.
    var upFrontier = topK.map(function (r) { return { rec: r, hop: 0 }; });
    while (upFrontier.length && expansions.length < MAX_EXPANSIONS) {
      var nextUp = [];
      for (var i2 = 0; i2 < upFrontier.length; i2++) {
        var fu = upFrontier[i2];
        if (fu.hop >= 2) continue;   // depth cap (matches downward)
        var name = fu.rec.symbol;
        if (!name) continue;
        var callers = (loadedCallerIndex &&
                       (loadedCallerIndex[name] || loadedCallerIndex[String(name).split('.').pop()])) || [];
        // Cap callers per node so a widely-used helper doesn't crowd out
        // other matches at the next hop.
        var CALLERS_PER_NODE = 2;
        for (var u = 0; u < callers.length && u < CALLERS_PER_NODE && expansions.length < MAX_EXPANSIONS; u++) {
          var caller = callers[u];
          var addedUp = tryAdd(caller, (caller.symbol || caller.path) + ' → ' + name,
                               fu.hop + 1, 'up', fu.rec.score);
          if (addedUp) nextUp.push({ rec: addedUp, hop: fu.hop + 1 });
        }
      }
      upFrontier = nextUp;
    }

    var merged = topK.concat(expansions);
    merged.forEach(function (r) { delete r._i; });
    cb(null, merged);
  } catch (e) { cb(e); }
};

exports.getGenState = function () { return genState; };

// Whether the generator fork is up and has finished loading the pipeline.
exports.isGeneratorReady = function () { return !!genForkReady; };

// Preload the embedder unconditionally (~25MB, cheap) and eagerly kick off
// the generator fork (~1.88GB download + load) so it's ready by the time the
// user needs it. `onGenProgress` gets the same progress objects that generate()
// emits (downloading / loading / ready / error).
exports.preload = function (onGenProgress) {
  onGenProgress = onGenProgress || function () {};
  var cacheDir = path.join(getUserDataPath(), 'fastack-rag', 'models');

  // ---- Embedder: small, always fetch ----
  (async function () {
    try {
      await ensureFilesCached(cacheDir, MODEL_ID, MODEL_FILES);
      await getEmbedder();
      console.log('[fastack] embedder ready');
    } catch (e) { console.log('[fastack] embedder preload failed:', e.message); }
  })();

  // Notify caller of every state change (downloading, loading, ready, error).
  onGenState(onGenProgress);

  // ---- Generator: skip if the fork is already up and loaded. ----
  if (genForkReady) { setGenState({ phase: 'ready' }); return; }

  ensureGenFork()
    .then(function () {
      setGenState({ phase: 'ready' });
      console.log('[fastack] generator ready');
    })
    .catch(function (e) {
      setGenState({ phase: 'error', error: e && e.message || String(e) });
      console.log('[fastack] generator preload failed:', e.message);
    });
};

exports.getMeta = function () {
  var a = exports.getActive();
  if (!a) return null;
  if (!fs.existsSync(metaFile(a.hash))) return { folder: a.folder, updatedAt: a.updatedAt };
  try { return JSON.parse(fs.readFileSync(metaFile(a.hash), 'utf8')); } catch (e) { return null; }
};
