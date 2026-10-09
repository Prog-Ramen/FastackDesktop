var $ = require('jquery');
var ls = require('local-storage');
var profileCache = require('../helper/profile_cache');
var taskMerge = require('../helper/task_merge');

function esc(value) {
  return String(value || '').replace(/[&<>"']/g, function (character) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character];
  });
}

function listItems() {
  var all = profileCache.list();
  var output = [{ key: 'Local|local|local', label: 'Local', provider: 'Local', stack: ls('stack') || { incomplete: [], complete: [] } }];
  Object.keys(all).forEach(function (key) {
    if (!all[key] || !all[key].stack || key === output[0].key) return;
    var parts = key.split('|');
    output.push({ key: key, label: parts[2] || parts[0], provider: parts[0], stack: all[key].stack });
  });
  return output;
}

function saveCurrent() {
  var key = ls('activeWorkspace') || 'Local|local|local';
  var parts = key.split('|');
  profileCache.save(parts[0], parts[1], parts[2], ls('stack') || { incomplete: [], complete: [] });
}

function openList(key) {
  var item = listItems().find(function (candidate) { return candidate.key === key; });
  if (!item) return;
  saveCurrent();
  ls('activeWorkspace', key);
  ls('stack', taskMerge.mergeStacks(item.stack));
  ls('currIndex', 0);
  location.replace('./stack.html');
}

$(function () {
  var selected = 0;
  var lastShortcut = { key: null, at: 0 };

  function render() {
    var active = ls('activeWorkspace') || 'Local|local|local';
    $('#taskLists').html(listItems().map(function (item, index) {
      var open = item.stack.incomplete || [];
      var done = item.stack.complete || [];
      var preview = open.slice(0, 3).map(function (task) { return '<li>' + esc(task.taskName) + '</li>'; }).join('');
      return '<button class="task-list-card' + (item.key === active ? ' is-active' : '') + '" data-key="' + esc(item.key) + '" data-index="' + index + '"><span class="list-card-top"><strong>' + esc(item.label) + '</strong><em>' + esc(item.provider) + '</em></span><span class="list-count">' + open.length + ' active · ' + done.length + ' completed</span>' + (preview ? '<ul>' + preview + '</ul>' : '<span class="list-empty">No active tasks</span>') + '</button>';
    }).join(''));
    select(Math.min(selected, Math.max(0, $('.task-list-card').length - 1)), false);
  }

  function select(index, focus) {
    var cards = $('.task-list-card');
    if (!cards.length) return;
    selected = Math.max(0, Math.min(index, cards.length - 1));
    cards.removeClass('is-key-selected').attr('aria-selected', 'false');
    cards.eq(selected).addClass('is-key-selected').attr('aria-selected', 'true');
    if (focus !== false) cards.eq(selected).focus();
  }

  function selectedCard() { return $('.task-list-card').eq(selected); }

  function createList() {
    var name = prompt('Task list name');
    if (!name || !name.trim()) return;
    saveCurrent();
    name = name.trim();
    profileCache.save('Local', 'local', name, { incomplete: [], complete: [], templates: [] });
    ls('activeWorkspace', 'Local|local|' + name);
    ls('stack', { incomplete: [], complete: [], templates: [] });
    location.replace('./stack.html');
  }

  function renameSelected() {
    var card = selectedCard();
    if (!card.length) return;
    var oldKey = card.data('key');
    if (oldKey === 'Local|local|local') return alert('The default Local list cannot be renamed.');
    var item = listItems().find(function (candidate) { return candidate.key === oldKey; });
    var name = prompt('Rename task list', item && item.label || '');
    if (!name || !name.trim() || !item) return;
    var parts = oldKey.split('|');
    var newKey = [parts[0], parts[1], name.trim()].join('|');
    profileCache.save(parts[0], parts[1], name.trim(), item.stack);
    profileCache.remove(oldKey);
    if (ls('activeWorkspace') === oldKey) ls('activeWorkspace', newKey);
    render();
  }

  function deleteSelected() {
    var card = selectedCard();
    if (!card.length) return;
    var key = card.data('key');
    if (key === 'Local|local|local') return alert('The default Local list cannot be deleted.');
    var label = card.find('strong').text();
    if (!confirm('Delete the task list “' + label + '”? Its cached tasks will be removed from this device.')) return;
    profileCache.remove(key);
    if (ls('activeWorkspace') === key) ls('activeWorkspace', 'Local|local|local');
    selected = Math.max(0, selected - 1);
    render();
  }

  function runShortcut(command) {
    var now = Date.now();
    if (lastShortcut.key === command && now - lastShortcut.at < 300) return;
    lastShortcut = { key: command, at: now };
    if (command === 'NewTask') createList();
    else if (command === 'ScrollTaskUp') select(selected - 1);
    else if (command === 'ScrollTaskDown') select(selected + 1);
    else if (command === 'OpenTask') { var card = selectedCard(); if (card.length) openList(card.data('key')); }
    else if (command === 'EditTask') renameSelected();
    else if (command === 'PopTask') deleteSelected();
    // Clock shortcuts are intentionally ignored: timers belong to tasks, not lists.
  }

  $('#newTaskList').on('click', createList);
  $('#taskLists').on('click', '.task-list-card', function () { openList($(this).data('key')); });
  window.FastackContextShortcuts = { scope: 'lists', run: runShortcut };
  if (window.__fastackPendingContextShortcut && window.__fastackPendingContextShortcut.scope === 'lists') {
    var pending = window.__fastackPendingContextShortcut;
    window.__fastackPendingContextShortcut = null;
    runShortcut(pending.key);
  }
  $(document).on('keydown', function (event) {
    var command = null;
    if (event.altKey && event.code === 'KeyN') command = 'NewTask';
    else if (event.altKey && event.key === 'ArrowUp') command = 'ScrollTaskUp';
    else if (event.altKey && event.key === 'ArrowDown') command = 'ScrollTaskDown';
    else if (event.altKey && event.key === 'Enter') command = 'OpenTask';
    else if (event.altKey && event.code === 'KeyE') command = 'EditTask';
    else if (event.altKey && event.code === 'KeyP') command = 'PopTask';
    if (command) { event.preventDefault(); runShortcut(command); }
    else if (event.key === 'Enter' && !event.altKey && document.activeElement.classList.contains('task-list-card')) document.activeElement.click();
  });
  render();
});
