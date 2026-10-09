'use strict';

// Native keyboard monitoring is intentionally isolated from Electron's main
// process. A native ABI or Core Graphics fault may end this worker, but can no
// longer take the Fastack window down with it.
var path = require('path');
var addon = null;

try {
  addon = require(path.join(__dirname, '..', 'native', 'build', 'Release', 'keyboard_addon.node'));
  var started = !!addon.start();
  if (process.send) process.send({ type: 'ready', started: started });
} catch (error) {
  if (process.send) process.send({ type: 'ready', started: false, error: error.message || String(error) });
}

process.on('message', function (message) {
  if (!message || message.type !== 'counts') return;
  var counts = { keyDown: 0, keyUp: 0 };
  try { if (addon && addon.getCounts) counts = addon.getCounts(); } catch (e) {}
  if (process.send) process.send({ type: 'counts', requestId: message.requestId, counts: counts });
});

// Do not invoke addon.stop(): older builds contain an unsafe Core Foundation
// cast. The OS releases the event tap when this worker exits.
