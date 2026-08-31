const test = require('node:test');
const assert = require('node:assert/strict');
const intelligence = require('../helper/intelligence');

test('semantic retrieval matches related task language', () => {
  const tasks = [
    { taskName: 'Review authentication outage', description: 'Investigate login failures' },
    { taskName: 'Write launch announcement', description: 'Marketing copy' }
  ];
  assert.equal(intelligence.searchTasks('login authentication failure', tasks, 1)[0].task.taskName, 'Review authentication outage');
});

test('estimate calibration uses actual time from similar completed work', () => {
  const result = intelligence.suggestEstimate('Review API launch checklist', [
    { taskName: 'Review launch checklist', timeTaken: 45 * 60000 }
  ]);
  assert.equal(result.minutes, 45);
});

test('ranking balances deadline pressure, priority, and quick wins', () => {
  const now = Date.now();
  const ranked = intelligence.rankTasks([
    { taskName: 'Later', priority: 50, ignoreDates: true, timeHours: 2, timeMins: 0 },
    { taskName: 'Overdue', priority: 10, ignoreDates: false, completionDate: new Date(now - 86400000).toISOString(), timeHours: 1, timeMins: 0 }
  ], now);
  assert.equal(ranked[0].task.taskName, 'Overdue');
});

test('focus analysis and weekly review degrade safely with sparse data', () => {
  const analysis = intelligence.analyzeSessions([{ session: { startTs: Date.now(), samples: [
    { category: 'write', idle: false }, { category: 'idle', idle: true }
  ] } }]);
  assert.equal(analysis.activePct, 50);
  assert.equal(typeof intelligence.weeklyReview({ incomplete: [], complete: [] }, []).focusScore, 'number');
});
