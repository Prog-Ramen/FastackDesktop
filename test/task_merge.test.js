const test = require('node:test');
const assert = require('node:assert/strict');
const merge = require('../helper/task_merge');

test('reconciles duplicate tasks and orders by deadline, priority, then creation', () => {
  const local = { incomplete: [
    { taskId: 'a', taskName: 'A', creationDate: '2026-08-01', completionDate: '2026-09-03', priority: 1 },
    { taskId: 'b', taskName: 'B', creationDate: '2026-08-02', completionDate: '2026-09-02', priority: 1 }
  ]};
  const cloud = { incomplete: [
    { taskId: 'a', taskName: 'A updated', creationDate: '2026-08-01', completionDate: '2026-09-03', priority: 5, updatedAt: '2026-08-30' },
    { taskId: 'c', taskName: 'C', creationDate: '2026-08-03', completionDate: '2026-09-03', priority: 9 }
  ]};
  const result = merge.mergeStacks(local, cloud);
  assert.equal(result.incomplete.length, 3);
  assert.equal(result.incomplete[0].taskId, 'b');
  assert.equal(result.incomplete[1].taskId, 'c');
  assert.equal(result.incomplete[2].taskName, 'A updated');
});

test('completed copy wins the active bucket for the same task ID', () => {
  const result = merge.mergeStacks(
    { incomplete: [{ taskId: 'x', taskName: 'X', creationDate: '2026-08-01' }] },
    { complete: [{ taskId: 'x', taskName: 'X', creationDate: '2026-08-01', complete: true, updatedAt: '2026-08-31' }] }
  );
  assert.equal(result.incomplete.length, 0);
  assert.equal(result.complete.length, 1);
});

test('preserves competing description edits as a conflict', () => {
  const result = merge.mergeStacks(
    { incomplete: [{ taskId: 'd', description: 'Local wording', updatedAt: '2026-08-31T10:00:00Z', sourceDevice: 'local' }] },
    { incomplete: [{ taskId: 'd', description: 'Cloud wording', updatedAt: '2026-08-31T10:00:00Z', sourceDevice: 'github' }] }
  );
  const task = result.incomplete[0];
  assert.equal(task.hasConflicts, true);
  assert.equal(task.descriptionConflicts.length, 2);
});

test('merges timer sessions from two devices without double counting', () => {
  const result = merge.mergeStacks(
    { incomplete: [{ taskId: 't', timeSessions: [{ sessionId: 's1', durationMs: 120000 }] }] },
    { incomplete: [{ taskId: 't', timeSessions: [{ sessionId: 's2', durationMs: 180000 }] }] }
  );
  assert.equal(result.incomplete[0].timeTaken, 300000);
  assert.equal(result.incomplete[0].timeSessions.length, 2);
});
