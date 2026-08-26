const { app, BrowserWindow, ipcMain, Tray, nativeImage, globalShortcut, dialog } = require('electron')
const path = require('path')
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

app.on('will-quit', () => {
  try { globalShortcut.unregisterAll(); } catch (e) { /* noop */ }
});

const assetsDir = path.join(__dirname, 'assets')

let tray = undefined
let window = undefined
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
    width: 300,
    height: 500,
    show: false,
    frame: false,
    resizable: true,
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

// Eagerly download + load the generator on startup so it's ready before the
// user needs it. Progress fans out to every open window so any renderer can
// display it. The download is ~1.88GB one-time; subsequent launches skip
// straight to loading from the cached files (5-15s).
try {
  rag.preload((progress) => {
    try {
      BrowserWindow.getAllWindows().forEach((w) => {
        if (w && !w.isDestroyed() && w.webContents && !w.webContents.isDestroyed()) {
          w.webContents.send('rag:gen-progress', progress);
        }
      });
    } catch (e) {}
  });
} catch (e) { console.log('[fastack] preload skipped:', e.message); }

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

ipcMain.on('register-shortcuts', (_evt, list) => {
  registeredAccels.forEach((a) => { try { globalShortcut.unregister(a); } catch (e) { /* noop */ } });
  registeredAccels.clear();
  (list || []).forEach((entry) => {
    if (!entry || !entry.accel) return;
    try {
      globalShortcut.register(entry.accel, () => {
        recentShortcutMs = Date.now();
        safeSendShortcut(window, entry.key);
      });
      registeredAccels.add(entry.accel);
    } catch (e) { /* invalid accelerator */ }
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
