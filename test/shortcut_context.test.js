const test = require('node:test');
const assert = require('node:assert/strict');
const context = require('../helper/shortcut_context');

test('routes every entity shortcut to the active collection type', () => {
  context.entityCommands.forEach(command => {
    assert.equal(context.route('/stack/taskLists.html', command).scope, 'lists');
    assert.equal(context.route('/stack/sops.html', command).scope, 'sops');
    assert.equal(context.route('/stack/stack.html', command).scope, 'tasks');
    assert.equal(context.route('/stack/taskDetail.html', command).scope, 'tasks');
  });
});

test('prevents entity shortcuts from mutating tasks on unrelated pages', () => {
  ['report.html', 'settings.html', 'createTask.html'].forEach(page => {
    context.entityCommands.forEach(command => assert.equal(context.route('/stack/' + page, command).scope, 'none'));
  });
  assert.equal(context.route('/stack/sops.html', 'NavigateRight').scope, 'global');
});
