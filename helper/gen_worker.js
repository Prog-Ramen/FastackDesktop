// Forked from main. Owns the Qwen1.5-1.8B-Chat pipeline so LLM inference runs
// in its own OS process and doesn't freeze the popup UI. Communicates with
// main over the built-in child_process IPC channel.
//
// Contract:
//   Main sends: { type:'load',     cacheDir, modelId }
//               { type:'generate', id, messages, opts }
//   We send:    { type:'ready' }
//               { type:'progress', phase, ... }
//               { type:'result',   id, text }
//               { type:'error',    id?, error }

// ---- Node 16 (bundled with Electron 19) has no fetch/Headers. Polyfill from
// undici so transformers.js can *look* for network — even though we never
// actually fetch (main pre-downloads all files before forking us).
try {
  if (typeof globalThis.ReadableStream === 'undefined') {
    const { ReadableStream, TransformStream, WritableStream } = require('node:stream/web');
    globalThis.ReadableStream = ReadableStream;
    globalThis.TransformStream = TransformStream;
    globalThis.WritableStream = WritableStream;
  }
} catch (e) {}
try {
  const undici = require('undici');
  globalThis.fetch = undici.fetch;
  globalThis.Headers = undici.Headers;
  globalThis.Request = undici.Request;
  globalThis.Response = undici.Response;
  globalThis.FormData = undici.FormData;
} catch (e) {}

var path = require('path');
var fs = require('fs');

var pipeRef = null;
var loadPromise = null;

function post(msg) {
  try { if (process.send) process.send(msg); } catch (e) {}
}

async function ensureLoaded(cacheDir, modelId) {
  if (pipeRef) return pipeRef;
  if (loadPromise) return loadPromise;
  loadPromise = (async function () {
    post({ type: 'progress', phase: 'loading' });
    var mod = await import('@xenova/transformers');
    mod.env.allowLocalModels = false;
    mod.env.cacheDir = cacheDir;
    var pipe = await mod.pipeline('text-generation', modelId);
    pipeRef = pipe;
    return pipe;
  })().catch(function (e) { loadPromise = null; throw e; });
  return loadPromise;
}

function extractText(out) {
  var last = Array.isArray(out) ? out[0] : out;
  var gen = last && last.generated_text;
  if (Array.isArray(gen)) {
    for (var k = gen.length - 1; k >= 0; k--) {
      if (gen[k] && gen[k].role === 'assistant') return gen[k].content || '';
    }
  } else if (typeof gen === 'string') {
    return gen;
  }
  return '';
}

process.on('message', async function (msg) {
  if (!msg || !msg.type) return;
  try {
    if (msg.type === 'load') {
      await ensureLoaded(msg.cacheDir, msg.modelId);
      post({ type: 'ready' });
    } else if (msg.type === 'generate') {
      await ensureLoaded(msg.cacheDir, msg.modelId);
      post({ type: 'progress', phase: 'generating', id: msg.id });
      var out = await pipeRef(msg.messages, msg.opts || {});
      var text = extractText(out);
      post({ type: 'result', id: msg.id, text: text });
    }
  } catch (e) {
    post({ type: 'error', id: msg && msg.id, error: (e && e.message) || String(e) });
  }
});

process.on('uncaughtException', function (e) {
  post({ type: 'error', error: 'uncaught: ' + ((e && e.message) || String(e)) });
});

// Announce we're alive so main knows the fork booted.
post({ type: 'progress', phase: 'worker-booted' });
