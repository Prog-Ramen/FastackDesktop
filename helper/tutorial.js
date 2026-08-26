// Fastack interactive tour.
// Walks the user through the real UI across the stack, createTask, and settings pages.
// Tour state persists in local-storage so it survives page navigation.
//
// Each page just calls tutorial.init() on load. If the tour is active and the current
// step belongs to this page, we highlight the target element + show a bottom-anchored
// coach mark. Shortcuts, target clicks, and the Next button all advance the tour.
//
// Keyboard on any tour card:
//   Enter / →   next     ← back     Esc skip     ? restart

var ls = require('local-storage');

// ---- Tour script ---------------------------------------------------------
// page:        HTML file name (or null = "show on any page")
// target:      CSS selector to highlight (optional)
// advanceOnClick: also advance when the target is clicked
// shortcut:    settings key (e.g. 'NewTask'); label pulled from live settings
// advanceOnShortcut: also advance when the matching keystroke fires while the popup is focused
// info:        true for "just read" steps that have no target
// Tour begins on createTask.html — first-time users land there automatically, and
// start() navigates existing users there when they replay the tour.
var TOUR_START_PAGE = 'createTask.html';

var TOUR = [
  { id: 'welcome',
    page: 'createTask.html', info: true,
    title: 'Welcome to Fastack',
    body: 'A keyboard-first task stack. Let\'s create your first task, then walk through the shortcuts that run everything. Press Esc anytime to skip.' },
  { id: 'task-name',
    page: 'createTask.html', target: '#tname',
    title: 'Task name',
    body: 'Only the name is required. Type anything — you\'ll be able to edit or pop it later.' },
  { id: 'priority',
    page: 'createTask.html', target: '#priority',
    title: 'Priority',
    body: '1 (low) to 100 (high). Higher priority sits closer to the top of the stack.' },
  { id: 'duration',
    page: 'createTask.html', target: '.centerTaskInput',
    title: 'Estimated duration',
    body: 'Optional. If set, clock-in shows a live countdown so you know if you\'re on pace.' },
  { id: 'submit-task',
    page: 'createTask.html', target: '#submitTask', advanceOnClick: true,
    title: 'Save the task',
    body: 'Click Create Task. You\'ll land on the stack with your new task at the top.' },
  { id: 'meet-task',
    page: 'stack.html', target: '#t0',
    title: 'Your task, on top',
    body: 'The top card is your current focus. Overdue tasks push to the top automatically; ties break by priority.' },
  { id: 'toolbar',
    page: 'stack.html', target: '.fastack-toolbar',
    title: 'The toolbar',
    body: 'Add task, clock, settings, logout. Each icon has an Alt shortcut — click or type, your choice.' },
  { id: 'clock-in',
    page: 'stack.html', info: true, shortcut: 'ClockIn', advanceOnShortcut: true,
    title: 'Clock in',
    body: 'Start tracking time on the top task. The card flips to a live countdown while you\'re clocked in.' },
  { id: 'clock-out',
    page: 'stack.html', info: true, shortcut: 'ClockOut', advanceOnShortcut: true,
    title: 'Clock out',
    body: 'Pause the timer. Elapsed time is preserved — clocking in again resumes where you left off.' },
  { id: 'pop-task',
    page: 'stack.html', info: true, shortcut: 'PopTask', advanceOnShortcut: true,
    title: 'Pop when done',
    body: 'Marks the top task complete and slides it off the stack. Completed tasks are kept in history.' },
  { id: 'scroll',
    page: 'stack.html', info: true, shortcut: 'ScrollTaskUp', advanceOnShortcut: true,
    title: 'Peek up / down',
    body: 'Scroll through the stack to see what\'s coming, without disturbing the top card.' },
  { id: 'open-settings',
    page: 'stack.html', target: '#settingsButton', advanceOnClick: true, shortcut: 'Settings', advanceOnShortcut: true,
    title: 'Open Settings',
    body: 'Click the gear (or use the shortcut) to rebind keys, replay this tour, or push a local stack to the cloud.' },
  { id: 'settings-shortcuts',
    page: 'settings.html', target: '.tab',
    title: 'Rebind any shortcut',
    body: 'Click any input, then press your new key combination. Escape cancels the recording.' },
  { id: 'settings-tour',
    page: 'settings.html', target: '#showTour',
    title: 'Replay this tour later',
    body: 'You can always come back here to walk through Fastack again.' },
  { id: 'settings-save',
    page: 'settings.html', target: '#update', advanceOnClick: true,
    title: 'Save & return',
    body: 'Save your changes and go back to the stack.' },
  { id: 'done',
    page: 'stack.html', info: true,
    title: "You're set",
    body: 'Press ? on the stack screen anytime to replay this tour. Happy stacking.' }
];

// ---- State helpers -------------------------------------------------------

var currentCard = null;
var currentHighlight = null;
var currentClickHandler = null;
var currentClickTarget = null;
var currentKeyHandler = null;
var globalKeyInstalled = false;

function pageFilename() {
  return (window.location.pathname || '').split('/').pop() || 'stack.html';
}

function stepIdx() {
  var i = parseInt(ls('tourStep'), 10);
  return isNaN(i) ? 0 : i;
}

function step() { return TOUR[stepIdx()]; }
function isActive() { return ls('tourActive') === true; }

function activate() {
  ls('tourActive', true);
  ls('tourStep', 0);
  // Mark seen the moment the tour is ever activated. Even if the user quits mid-tour
  // without finishing or explicitly skipping, we won't auto-start it again — the tour
  // is a one-shot first-run experience. Manual re-triggering (Show tour, ?) still works.
  ls('tourSeen', true);
  var s = ls('settings') || {};
  s.skipTutorial = false;
  ls('settings', s);
}

function deactivate() {
  ls.remove('tourActive');
  ls.remove('tourStep');
  // Persistent "we've shown this at least once" flag. Survives logout/relogin because
  // loginGithub.js only clears auth-related keys — not this one.
  ls('tourSeen', true);
  var s = ls('settings') || {};
  s.skipTutorial = true;
  ls('settings', s);
}

function shortcutText(key) {
  if (!key) return null;
  var s = ls('settings') || {};
  return s[key] || {
    OpenCloseWindow: 'Alt+Z', NewTask: 'Alt+N', EditTask: 'Alt+E',
    ClockIn: 'Alt+C', ClockOut: 'Alt+V', PopTask: 'Alt+P',
    ScrollTaskUp: 'Alt+Up', ScrollTaskDown: 'Alt+Down',
    Settings: 'Alt+S', Logout: 'Alt+L'
  }[key] || key;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---- Rendering -----------------------------------------------------------

function renderCard(s) {
  removeCard();
  var idx = stepIdx();
  var total = TOUR.length;
  var sc = shortcutText(s.shortcut);
  var scHtml = sc ? '<span class="tour-shortcut">' + escapeHtml(sc) + '</span>' : '';
  var isLast = idx === total - 1;
  var mustAct = !!(s.advanceOnClick || s.advanceOnShortcut);

  // On mandatory steps, Next is hidden — the user must actually perform the action.
  // A hint replaces it so they know what unblocks progress.
  var hintHtml = '';
  if (mustAct) {
    var msg;
    if (s.advanceOnClick && s.advanceOnShortcut)      msg = 'Click the highlighted button or press ' + escapeHtml(sc);
    else if (s.advanceOnClick)                        msg = 'Click the highlighted button to continue';
    else                                              msg = 'Press ' + escapeHtml(sc) + ' to continue';
    hintHtml = '<div class="tour-hint">' + msg + '</div>';
  }

  var nextHtml = mustAct
    ? ''
    : '<button type="button" class="tour-btn tour-next">' + (isLast ? 'Done ✓' : 'Next →') + '</button>';
  var backHtml = idx > 0 ? '<button type="button" class="tour-btn tour-back">Back</button>' : '<span class="tour-spacer"></span>';

  var card = document.createElement('div');
  card.className = 'tour-card' + (mustAct ? ' tour-card-must-act' : '');
  card.innerHTML =
    '<div class="tour-progress"><div class="tour-progress-bar" style="width:' + ((idx + 1) / total * 100) + '%"></div></div>' +
    '<div class="tour-counter">Step ' + (idx + 1) + ' of ' + total + '</div>' +
    '<div class="tour-title">' + escapeHtml(s.title) + ' ' + scHtml + '</div>' +
    '<div class="tour-body">' + escapeHtml(s.body) + '</div>' +
    hintHtml +
    '<div class="tour-actions">' +
      '<button type="button" class="tour-btn tour-skip">Skip tour</button>' +
      backHtml +
      nextHtml +
    '</div>';
  document.body.appendChild(card);
  currentCard = card;

  var next = card.querySelector('.tour-next');
  if (next) next.addEventListener('click', advance);
  card.querySelector('.tour-skip').addEventListener('click', finish);
  var back = card.querySelector('.tour-back');
  if (back) back.addEventListener('click', goBack);
}

function highlightTarget(selector) {
  removeHighlight();
  if (!selector) return;
  var el = document.querySelector(selector);
  if (!el) return;
  el.classList.add('tour-highlight');
  currentHighlight = el;
  // Nudge the card up if the target is near the bottom of the popup, so they don't overlap.
  var rect = el.getBoundingClientRect();
  var vh = window.innerHeight;
  if (rect.top > vh * 0.55 && currentCard) {
    currentCard.classList.add('tour-card-top');
  }
}

function attachClickAdvance(selector) {
  detachClickAdvance();
  if (!selector) return;
  var el = document.querySelector(selector);
  if (!el) return;
  currentClickTarget = el;
  // Capture phase so we advance the tour step BEFORE any navigation kicks in
  // (the target's normal click handler may window.location.replace(...)).
  currentClickHandler = function () { advance(); };
  el.addEventListener('click', currentClickHandler, true);
}

function keyMatches(event, comboText) {
  if (!comboText) return false;
  var parts = String(comboText).split('+').map(function (p) { return p.trim(); });
  var last = parts[parts.length - 1].toLowerCase();
  var wantAlt = parts.some(function (p) { return /^alt|option$/i.test(p); });
  var wantCtrl = parts.some(function (p) { return /^(ctrl|control)$/i.test(p); });
  var wantMeta = parts.some(function (p) { return /^(cmd|meta|command)$/i.test(p); });
  var wantShift = parts.some(function (p) { return /^shift$/i.test(p); });

  // event.key is affected by Alt on macOS (Alt+C → "ç"). Fall back to event.code
  // which is layout- and modifier-independent: "KeyC", "ArrowUp", "Digit5", etc.
  var evKey = (event.key || '').toLowerCase();
  var evCode = (event.code || '').toLowerCase();
  var arrows = { arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right' };
  if (arrows[evKey]) evKey = arrows[evKey];

  var keyOK = (evKey === last)
           || (last.length === 1 && evCode === 'key' + last)     // letters
           || (evCode === 'arrow' + last)                        // arrows: "up" → "arrowup"
           || (/^\d$/.test(last) && evCode === 'digit' + last);  // digits

  return keyOK
    && event.altKey === wantAlt
    && event.ctrlKey === wantCtrl
    && event.metaKey === wantMeta
    && event.shiftKey === wantShift;
}

function attachShortcutAdvance(settingsKey) {
  detachShortcutAdvance();
  if (!settingsKey) return;
  var comboText = shortcutText(settingsKey);
  currentKeyHandler = function (e) {
    if (keyMatches(e, comboText)) advanceForShortcut(settingsKey);
  };
  // Capture so we beat any target handler. On macOS Electron, globalShortcut can
  // consume the event before it reaches the DOM at all, so we ALSO wire settings.js
  // to call tutorial.notifyShortcut() from inside each globalShortcut callback.
  window.addEventListener('keydown', currentKeyHandler, true);
}

// Advance only if the tour is on a step that actually expects `settingsKey`.
// Idempotent — safe to call from both the DOM keydown listener AND from settings.js
// globalShortcut callbacks; whichever fires second is a no-op.
function advanceForShortcut(settingsKey) {
  if (!isActive()) return;
  var s = step();
  if (!s) return;
  if (!s.advanceOnShortcut) return;
  if (s.shortcut !== settingsKey) return;
  advance();
}

// ---- Show / advance / finish --------------------------------------------

function showCurrent() {
  if (!isActive()) return;
  var s = step();
  if (!s) return finish();
  if (s.page && s.page !== pageFilename()) {
    // Not our page — clear any leftover and wait.
    removeCard(); removeHighlight();
    return;
  }
  renderCard(s);
  highlightTarget(s.target);
  if (s.advanceOnClick) attachClickAdvance(s.target);
  if (s.advanceOnShortcut) attachShortcutAdvance(s.shortcut);
}

function advance() {
  var next = stepIdx() + 1;
  detachClickAdvance();
  detachShortcutAdvance();
  if (next >= TOUR.length) return finish();
  ls('tourStep', next);
  // Small transition delay so the highlight change feels intentional.
  removeHighlight();
  setTimeout(showCurrent, 180);
}

function goBack() {
  var prev = stepIdx() - 1;
  if (prev < 0) return;
  detachClickAdvance();
  detachShortcutAdvance();
  ls('tourStep', prev);
  removeHighlight();
  setTimeout(showCurrent, 100);
}

function finish() {
  deactivate();
  removeCard();
  removeHighlight();
  detachClickAdvance();
  detachShortcutAdvance();
}

// ---- Cleanup helpers ----------------------------------------------------

function removeCard() {
  if (currentCard && currentCard.parentNode) currentCard.parentNode.removeChild(currentCard);
  currentCard = null;
}
function removeHighlight() {
  if (currentHighlight) currentHighlight.classList.remove('tour-highlight');
  currentHighlight = null;
}
function detachClickAdvance() {
  if (currentClickTarget && currentClickHandler) currentClickTarget.removeEventListener('click', currentClickHandler, true);
  currentClickTarget = null; currentClickHandler = null;
}
function detachShortcutAdvance() {
  if (currentKeyHandler) window.removeEventListener('keydown', currentKeyHandler, true);
  currentKeyHandler = null;
}

// ---- Global key handler (Esc skip, ? restart) ---------------------------

function installGlobalKeys() {
  if (globalKeyInstalled) return;
  globalKeyInstalled = true;
  window.addEventListener('keydown', function (e) {
    var t = e.target;
    var typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if (currentCard && e.key === 'Escape') {
      e.preventDefault();
      finish();
      return;
    }
    if (!typing && e.key === '?') {
      e.preventDefault();
      exports.start();
    }
  });
}

// ---- Public API ---------------------------------------------------------

exports.init = function () {
  installGlobalKeys();
  if (isActive()) {
    // Resume in-progress tour — settings.js/stack.js need a beat to populate ls('settings').
    setTimeout(showCurrent, 350);
    return;
  }
  // Auto-start on the very first launch. tourSeen persists locally so we only ever
  // do this once. Manual re-trigger from Settings or "?" still works.
  if (ls('tourSeen') === true) return;
  var s = ls('settings') || {};
  if (s.skipTutorial === true) { ls('tourSeen', true); return; }
  setTimeout(function () { exports.start(); }, 500);
};

exports.start = function () {
  activate();
  removeCard(); removeHighlight();
  detachClickAdvance(); detachShortcutAdvance();
  // The tour begins on createTask.html so users learn the full flow from step 1.
  // If we're not already there, navigate and let the new page's init() pick it up.
  if (pageFilename() !== TOUR_START_PAGE) {
    ls('createPage', 'add');
    window.location.replace('./' + TOUR_START_PAGE);
    return;
  }
  setTimeout(showCurrent, 200);
};

// Kept as a public alias for older wiring; init() now handles first-run auto-start too.
exports.startIfFirstRun = function () { exports.init(); };

// Called by settings.js from inside each globalShortcut callback so the tour can
// advance on shortcuts that Electron consumes before the DOM ever sees them.
exports.notifyShortcut = advanceForShortcut;
