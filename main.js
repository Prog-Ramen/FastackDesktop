const { app, BrowserWindow, ipcMain, Tray, nativeImage, globalShortcut, dialog } = require('electron')
const path = require('path')
const https = require('https')
require('@electron/remote/main').initialize()

// --- Shortcut registration lives in main so callbacks don't close over a
// specific renderer. On each page load the renderer sends its accelerator
// map to `register-shortcuts`; when a shortcut fires we IPC-send its name to
// whatever renderer is currently alive. If no renderer is up, we no-op —
// no "Render frame was disposed" errors possible. ---------------------------
let registeredAccels = new Set();
let recentShortcutMs = 0;
// While a native modal (open dialog, save dialog, permission prompt kicked
// off by main) is up, the popup blurs but must not hide — otherwise it
// disappears behind the modal and the user thinks the app crashed.
let modalDepth = 0;
// Absolute timestamp until which blur→hide is suspended regardless of modal
// depth. Used to cover the focus flicker that macOS emits when a sheet-
// modal folder picker closes and focus transfers back to the popup.
let hideSuspendedUntil = 0;

function safeSendShortcut(win, key) {
  try {
    if (!win || (win.isDestroyed && win.isDestroyed())) return;
    const wc = win.webContents;
    if (!wc || wc.isDestroyed()) return;
    if (wc.isLoading()) { console.log('[fastack] shortcut %s dropped: renderer loading', key); return; }
    const mf = wc.mainFrame;
    if (!mf) { console.log('[fastack] shortcut %s dropped: no mainFrame', key); return; }
    // Accessing processId on a disposed WebFrameMain throws — probe once.
    try { const _ = mf.processId; } catch (e) { console.log('[fastack] shortcut %s dropped: mainFrame disposed', key); return; }
    wc.send('shortcut', key);
  } catch (e) { /* renderer gone */ }
}

function githubPostForm(pathname, fields) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(fields).toString();
    const request = https.request({
      hostname: 'github.com', port: 443, path: pathname, method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'FastackDesktop/1.0'
      },
      timeout: 30000
    }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => {
        try {
          const parsed = JSON.parse(text || '{}');
          if (response.statusCode >= 400 && !parsed.error) parsed.error = 'HTTP ' + response.statusCode;
          resolve(parsed);
        } catch (error) { reject(new Error('GitHub returned an invalid response.')); }
      });
    });
    request.on('timeout', () => request.destroy(new Error('GitHub authentication timed out.')));
    request.on('error', reject);
    request.end(body);
  });
}

// Register authentication IPC before any window can load. These handlers use
// fetch only when invoked, after the network polyfill below has initialized.
ipcMain.handle('github-device:start', async (_event, clientId) => {
  try {
    const body = await githubPostForm('/login/device/code', { client_id: clientId, scope: 'repo' });
    if (body.error) return { ok: false, error: body.error, description: body.error_description };
    return { ok: true, deviceCode: body.device_code, userCode: body.user_code, verificationUri: body.verification_uri, expiresIn: body.expires_in, interval: body.interval || 5 };
  } catch (error) { return { ok: false, error: error.message || String(error) }; }
});

ipcMain.handle('github-device:poll', async (_event, params) => {
  try {
    const body = await githubPostForm('/login/oauth/access_token', { client_id: params.clientId, device_code: params.deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
    if (body.access_token) return { ok: true, token: body.access_token };
    return { ok: false, pending: body.error === 'authorization_pending', slowDown: body.error === 'slow_down', error: body.error, description: body.error_description };
  } catch (error) { return { ok: false, error: error.message || String(error) }; }
});
console.log('[fastack] GitHub device authentication ready');

app.on('will-quit', () => {
  try { globalShortcut.unregisterAll(); } catch (e) { /* noop */ }
});

const assetsDir = path.join(__dirname, 'assets')

let tray = undefined
let window = undefined
const windowPresets = {
  compact:  { width: 300, height: 420 },
  standard: { width: 340, height: 560 },
  large:    { width: 400, height: 680 }
};
let currentWindowPreset = 'standard';

function resetWindowPosition() {
  if (!window || !tray || window.isDestroyed()) return;
  const trayPos = tray.getBounds();
  const bounds = window.getBounds();
  const display = require('electron').screen.getDisplayNearestPoint({ x: Math.round(trayPos.x), y: Math.round(trayPos.y) });
  const work = display.workArea;
  let x = Math.round(trayPos.x + trayPos.width / 2 - bounds.width / 2);
  let y = process.platform === 'darwin' ? Math.round(trayPos.y + trayPos.height) : Math.round(trayPos.y - bounds.height);
  x = Math.max(work.x, Math.min(x, work.x + work.width - bounds.width));
  y = Math.max(work.y, Math.min(y, work.y + work.height - bounds.height));
  window.setPosition(x, y, false);
}

function applyWindowPreset(name) {
  if (!windowPresets[name]) name = 'standard';
  currentWindowPreset = name;
  if (window && !window.isDestroyed()) {
    window.setSize(windowPresets[name].width, windowPresets[name].height, true);
    // Keep the popup anchored to its original tray location when a page or
    // settings screen reapplies the size preset.
    resetWindowPosition();
  }
  return { preset: name, width: windowPresets[name].width, height: windowPresets[name].height };
}
function start_context() {
  // This method is called once Electron is ready to run our code
  // It is effectively the main method of our Electron app
  require('electron-context-menu')({
    prepend: (params, browserWindow) => [{
      label: 'Rainbow',
      // Only show it when right-clicking images
      visible: params.mediaType === 'image'
    }]
  });
}

app.on('ready', () => {

  // Setup the menubar with an icon
  let icon = nativeImage.createFromDataURL(base64Icon);
  var imageFile = './images/va@2x.png';
  if (process.platform == 'darwin') {
    imageFile = './images/mac@2x.png';
  }
  tray = new Tray(imageFile);


  // Add a click handler so that when the user clicks on the menubar icon, it shows
  // our popup window
  var first = 0;
  tray.on('click', function (event) {
    toggleWindow();

    // Show devtools when command clicked
    if (window.isVisible() && process.defaultApp && event.metaKey) {
      window.openDevTools({ mode: 'detach' })
    }
  });

  // Make the popup window for the menubar
  window = new BrowserWindow({
    width: windowPresets.standard.width,
    height: windowPresets.standard.height,
    show: false,
    frame: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    transparent: true,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    }
  });
  if (process.env.FASTACK_DEV === '1' || !app.isPackaged) {
    // Only open devtools automatically during development.
    // Set FASTACK_DEV=0 to suppress even when running unpackaged.
    if (process.env.FASTACK_DEV !== '0') {
      window.webContents.openDevTools({ mode: 'detach' });
    }
  }
  require('@electron/remote/main').enable(window.webContents);
  // Tell the popup window to load our loginGithub.html file.
  // FASTACK_LOCAL=1 skips the OAuth screen and drops straight into Local mode.
  const homeQuery = process.env.FASTACK_LOCAL === '1' ? '?local=1' : '';
  window.loadURL(`file://${path.join(__dirname, './home.html')}${homeQuery}`);
  applyWindowPreset('standard');

  // Only close the popup on blur if dev tools isn't opened.
  // Delay + re-check so a transient blur (macOS accessibility prompt, or the
  // focus flicker when a globalShortcut fires) doesn't nuke the popup while
  // the user is trying to clock in/out.
  window.on('blur', () => {
    if (window.webContents.isDevToolsOpened()) return;
    setTimeout(() => {
      if (!window) return;
      if (window.isDestroyed && window.isDestroyed()) return;
      if (window.webContents.isDevToolsOpened()) return;
      if (window.isFocused()) return;
      if (modalDepth > 0) return;
      if (Date.now() < hideSuspendedUntil) return;
      if (Date.now() - recentShortcutMs < 700) return;
      window.hide();
    }, 350);
  });

  // Instrument frame lifecycle to catch the "who disposed my renderer" question.
  window.webContents.on('did-start-navigation', (_e, url) => console.log('[fastack] nav start ->', url));
  window.webContents.on('did-finish-load', () => console.log('[fastack] load done'));
  window.webContents.on('did-fail-load', (_e, code, desc, url) => console.log('[fastack] load FAILED %s %s (%s)', code, desc, url));
  window.webContents.on('render-process-gone', (_e, details) => console.log('[fastack] RENDERER GONE:', details));
  window.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (message && (message.indexOf('[fastack]') !== -1 || message.indexOf('Dropbox') !== -1)) {
      console.log('[renderer]', message, '(' + sourceId + ':' + line + ')');
    }
  });
  window.webContents.on('unresponsive', () => console.log('[fastack] renderer unresponsive'));
  window.webContents.on('responsive', () => console.log('[fastack] renderer responsive again'));
});

//Hide/Show on toggle
const toggleWindow = () => {
  if (window.isVisible()) {
    window.hide()
  } else {
    showWindowbef()
  }
};

//Position window at the correct location according to the tray
var first = 0;
const showWindowbef = () => {
  const trayPos = tray.getBounds();
  const windowPos = window.getBounds();
  if (first === 0) {
    var x, y = 0;
    if (process.platform == 'darwin') {
      x = Math.round(trayPos.x + (trayPos.width / 2) - (windowPos.width / 2));
      y = Math.round(trayPos.y + trayPos.height)
    } else {
      console.log(trayPos);
      x = Math.round(trayPos.x + (trayPos.width / 2) - (windowPos.width / 2));
      y = Math.round(trayPos.y - 500)
    }
    first++;
    window.setPosition(x, y, false);
  }


  window.show();
  window.focus()
};

ipcMain.handle('window:set-size', (_event, preset) => applyWindowPreset(preset));
ipcMain.handle('window:cycle-size', () => {
  const order = ['compact', 'standard', 'large'];
  const next = order[(order.indexOf(currentWindowPreset) + 1) % order.length];
  const result = applyWindowPreset(next);
  return result;
});
ipcMain.handle('window:reset-position', () => { return applyWindowPreset(currentWindowPreset); });
ipcMain.handle('window:get-layout', () => ({ preset: currentWindowPreset, bounds: window && !window.isDestroyed() ? window.getBounds() : null }));


ipcMain.on('show-window', () => {
  showWindow()
});

ipcMain.handle('pick-folder', async (_evt, opts) => {
  modalDepth++;
  hideSuspendedUntil = Date.now() + 15000;
  console.log('[fastack] pick-folder OPEN · modalDepth=%d', modalDepth);
  try {
    // IMPORTANT: do NOT pass `window` as parent here. On macOS a sheet-modal
    // attached to a transparent/frameless panel causes Electron to hide the
    // parent panel when the sheet closes. App-modal (no parent) leaves the
    // popup alone.
    const result = await dialog.showOpenDialog(Object.assign({
      title: 'Choose a folder',
      properties: ['openDirectory']
    }, opts || {}));
    if (result.canceled || !result.filePaths || !result.filePaths.length) return null;
    return result.filePaths[0];
  } finally {
    try {
      if (window && !window.isDestroyed() && !window.isVisible()) window.show();
    } catch (e) {}
    hideSuspendedUntil = Date.now() + 3000;
    modalDepth = Math.max(0, modalDepth - 1);
    console.log('[fastack] pick-folder CLOSE · modalDepth=%d', modalDepth);
  }
});

// ---- RAG (runs in main so the renderer heap stays small) --------------------
// Electron 19 ships Node 16, which has no global fetch/Headers/Request/Response.
// @xenova/transformers needs them to download the model from HuggingFace, so
// polyfill from undici BEFORE requiring anything that touches transformers.
// 1. Force Node 16's internal web streams onto the global scope
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

// 2. NOW it is safe to require undici. Overwrite unconditionally — Electron
// may ship a partial `fetch` that lacks web-streams behavior transformers.js
// depends on, which manifests as "Error: terminated" mid-download.
try {
  const undici = require('undici');
  globalThis.fetch = undici.fetch;
  globalThis.Headers = undici.Headers;
  globalThis.Request = undici.Request;
  globalThis.Response = undici.Response;
  globalThis.FormData = undici.FormData;
  const agent = new undici.Agent({
    connect: { timeout: 60_000 },
    bodyTimeout: 300_000,
    headersTimeout: 60_000,
    keepAliveTimeout: 60_000,
    keepAliveMaxTimeout: 600_000,
  });
  undici.setGlobalDispatcher(agent);
} catch (e) {
  console.log('[fastack] undici polyfill unavailable:', e.message);
}

const rag = require('./helper/rag');

// The generator is intentionally prepared on demand. Eager startup would
// surprise new users with a ~1.9 GB download before they choose an AI action.
ipcMain.handle('rag:prepare', async () => {
  try {
    rag.preload((progress) => {
      try {
        BrowserWindow.getAllWindows().forEach((w) => {
          if (w && !w.isDestroyed() && w.webContents && !w.webContents.isDestroyed()) w.webContents.send('rag:gen-progress', progress);
        });
      } catch (e) {}
    });
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message || String(e) }; }
});

ipcMain.handle('rag:get-meta', () => { try { return rag.getMeta(); } catch (e) { return null; } });
ipcMain.handle('rag:is-gen-ready', () => { try { return !!rag.isGeneratorReady(); } catch (e) { return false; } });
ipcMain.handle('rag:get-gen-state', () => { try { return rag.getGenState(); } catch (e) { return { phase: 'idle' }; } });
ipcMain.handle('rag:get-active', () => { try { return rag.getActive(); } catch (e) { return null; } });
ipcMain.handle('rag:clear', () => { try { rag.clear(); return true; } catch (e) { return false; } });

ipcMain.handle('rag:index', async (evt, folder) => {
  return await new Promise((resolve) => {
    rag.indexFolder(folder, (progress) => {
      try {
        const wc = evt.sender;
        if (wc && !wc.isDestroyed()) wc.send('rag:progress', progress);
      } catch (e) { /* renderer went away */ }
    }, (err, result) => {
      if (err) {
        const msg = err.message || String(err);
        const cause = err.cause ? ' (cause: ' + (err.cause.message || err.cause) + ')' : '';
        console.log('[fastack] rag:index FAILED:', msg + cause);
        resolve({ ok: false, error: msg + cause });
      } else resolve({ ok: true, result });
    });
  });
});

ipcMain.handle('rag:search', async (_evt, query, k) => {
  return await new Promise((resolve) => {
    rag.search(query, k, (err, hits) => {
      if (err) resolve({ ok: false, error: err.message || String(err) });
      else resolve({ ok: true, hits: hits || [] });
    });
  });
});

// rag:generate — local LLM (Qwen1.5-1.8B-Chat) runs in a forked child.
// mode='notes'       -> markdown task notes based on title (+ RAG context)
// mode='description' -> plain-text 1-2 sentence summary of an existing notes body
ipcMain.handle('rag:generate', async (evt, params) => {
  params = params || {};
  const title = params.title;
  const mode = params.mode || 'notes';
  const notesBody = params.notesBody || '';
  const useContext = !!params.useContext;

  // Only fetch RAG chunks for notes mode; description mode summarizes existing text.
  let contextChunks = [];
  if (useContext && mode === 'notes') {
    try {
      contextChunks = await new Promise((resolve) => {
        rag.search(title, 3, (err, hits) => resolve(err ? [] : (hits || [])));
      });
    } catch (e) { contextChunks = []; }
  }

  return await new Promise((resolve) => {
    rag.generate({
      title: title,
      mode: mode,
      notesBody: notesBody,
      contextChunks: contextChunks,
      onProgress: (progress) => {
        try {
          const wc = evt.sender;
          if (wc && !wc.isDestroyed()) wc.send('rag:gen-progress', progress);
        } catch (e) {}
      }
    }, (err, result) => {
      if (err) {
        const msg = err.message || String(err);
        const cause = err.cause ? ' (cause: ' + (err.cause.message || err.cause) + ')' : '';
        console.log('[fastack] rag:generate FAILED:', msg + cause);
        resolve({ ok: false, error: msg + cause });
      } else resolve({ ok: true, text: (result && result.text) || '' });
    });
  });
});

// ---- Keyboard addon (optional, disabled by default) -------------------------
// Native Core Graphics event tap for global keyboard capture.
// Needs Accessibility permission on macOS Sonoma+. Falls back to idle-only.
var keyboardAddon = null;
var keyboardEnabled = false;
var keyboardWorker = null;
var keyboardWorkerReady = false;
var keyboardRequestId = 0;
var keyboardRequests = new Map();

function initKeyboardAddon() {
  if (keyboardWorker) return;
  var fork = require('child_process').fork;
  keyboardWorkerReady = false;
  keyboardWorker = fork(path.join(__dirname, 'helper', 'keyboard_worker.js'), [], {
    env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' }),
    stdio: ['ignore', 'ignore', 'ignore', 'ipc']
  });
  keyboardWorker.on('message', function (message) {
    if (message.type === 'ready') {
      keyboardWorkerReady = !!message.started;
      keyboardEnabled = keyboardWorkerReady;
      console.log('[fastack] keyboard worker', keyboardEnabled ? 'started' : 'unavailable');
    } else if (message.type === 'counts') {
      var resolve = keyboardRequests.get(message.requestId);
      if (resolve) { keyboardRequests.delete(message.requestId); resolve(message.counts); }
    }
  });
  keyboardWorker.on('exit', function (code, signal) {
    console.log('[fastack] keyboard worker exited:', signal || code);
    keyboardWorker = null; keyboardWorkerReady = false; keyboardEnabled = false;
    keyboardRequests.forEach(function (resolve) { resolve({ keyDown: 0, keyUp: 0 }); });
    keyboardRequests.clear();
  });
}

function stopKeyboardAddon() {
  if (keyboardWorker) keyboardWorker.kill();
  keyboardWorker = null; keyboardWorkerReady = false; keyboardEnabled = false;
}

ipcMain.handle('keyboard:get-counts', () => {
  if (!keyboardWorkerReady || !keyboardWorker) return { keyDown: 0, keyUp: 0 };
  return new Promise(function (resolve) {
    var requestId = ++keyboardRequestId;
    keyboardRequests.set(requestId, resolve);
    try { keyboardWorker.send({ type: 'counts', requestId: requestId }); }
    catch (e) { keyboardRequests.delete(requestId); resolve({ keyDown: 0, keyUp: 0 }); }
    setTimeout(function () {
      if (keyboardRequests.delete(requestId)) resolve({ keyDown: 0, keyUp: 0 });
    }, 1000);
  });
});

ipcMain.handle('keyboard:status', () => ({ enabled: keyboardEnabled, worker: !!keyboardWorker }));

ipcMain.on('keyboard:init', () => {
  if (!keyboardEnabled) initKeyboardAddon();
});

ipcMain.on('keyboard:stop', () => {
  stopKeyboardAddon();
});

ipcMain.on('register-shortcuts', (_evt, list) => {
  registeredAccels.forEach((a) => { try { globalShortcut.unregister(a); } catch (e) { /* noop */ } });
  registeredAccels.clear();
  (list || []).forEach((entry) => {
    if (!entry || !entry.accel) return;
    try {
      const registered = globalShortcut.register(entry.accel, () => {
        recentShortcutMs = Date.now();
        if (entry.key === 'WindowSize') {
          const layout = applyWindowPreset(['compact', 'standard', 'large'][( ['compact', 'standard', 'large'].indexOf(currentWindowPreset) + 1) % 3]);
          resetWindowPosition();
          try { window.webContents.send('window-layout-changed', layout); } catch (e) {}
          safeSendShortcut(window, entry.key);
        } else if (entry.key === 'ResetWindowPosition') {
          resetWindowPosition();
          safeSendShortcut(window, entry.key);
        } else {
          safeSendShortcut(window, entry.key);
        }
      });
      if (registered) registeredAccels.add(entry.accel);
      else console.error('[fastack] shortcut registration failed:', entry.key, entry.accel);
    } catch (e) { console.error('[fastack] invalid shortcut:', entry.key, entry.accel, e.message || e); }
  });
});
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");


app.on('window-all-closed', () => {
  // On macOS it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit()
  }
});

// Tray Icon as Base64 so tutorial has less overhead
let base64Icon = `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAYCAYAAACbU/80AAAACXBIWXMAAC4jAAAuIwF4pT92AAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAbhJREFUeNpiYhhgwESpAcIr5hlQop+RDAsTgJQ/EDsAsQCa9AEgXgjEG95GJH2gqgOAFgcAqX4gViBCOcjyRKAjNlAlCoCWNwCp9URazgANmfVAffMpdgDU8noyoziBkCOYCFjuQIHlyI4IIDcE6qmU2/pJdgA0ezmQY5scNw+DjoAQspACNPeQFAIB5FhuLSbBsN/dn+EAEIMcggTsSXUAhoZIRRWGdDUtnBpA8hsdPRn4WdkYrnx4x/Do6xeUUMCmh4UU3002swXTugLCDDmnDqPItRqawx234v4dhurzJ9G1O1BcFOdCLY1ACgmQbxfZOMP5XVcvgB338fcvbIUTSSGAoWE50GewkAD5GBLsqvAEB3IgTA0WcIHUEDiITRBkwQqoJSBHgCwH+dZh50Z8lpPlAJzlOCiIYY4AJTZHoOUgmgBYSHJlBC1GE/BluSvv32GLb3RwAFgxOZKTCAtxJR4QOPrqBTGWf4CaQ3pRDK3THfE5gghQCDTnAtm1IVQzOY4AqQ8E6l9AcXsA6ghFIJ5ApOUgSw2JaZCQ0yQTgNYT9mjF6wMgvghtjj1gGCqAaaAdABBgAKMnmwocnYhOAAAAAElFTkSuQmCC`;
