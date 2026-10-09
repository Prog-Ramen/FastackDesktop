// Safe executable SOP core. The engine never evaluates code or invokes a shell.
// Every machine action must be provided as an explicit, permissioned adapter.

var STEP_TYPES = { instruction: true, approval: true, action: true, call_sop: true };

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function unique(values) { return Array.from(new Set(values || [])); }

exports.validate = function (sop) {
  var errors = [];
  if (!sop || typeof sop !== 'object') return { ok: false, errors: ['SOP is required.'] };
  if (!sop.id) errors.push('SOP id is required.');
  if (!sop.title || !String(sop.title).trim()) errors.push('SOP title is required.');
  if (!Array.isArray(sop.steps) || !sop.steps.length) errors.push('At least one step is required.');
  (sop.steps || []).forEach(function (step, index) {
    var at = 'Step ' + (index + 1);
    if (!step.id) errors.push(at + ' requires an id.');
    if (!STEP_TYPES[step.type]) errors.push(at + ' has an unsupported type.');
    if (step.type === 'call_sop' && !step.sopId) errors.push(at + ' requires sopId.');
    if (step.type === 'action') {
      if (!step.adapter) errors.push(at + ' requires an adapter.');
      if (!step.permission) errors.push(at + ' requires a permission.');
    }
  });
  return { ok: !errors.length, errors: errors };
};

exports.plan = function (rootId, getSop) {
  var flattened = [], requiredPermissions = [], stack = [];
  function visit(sopId, lineage) {
    if (stack.indexOf(sopId) !== -1) throw new Error('SOP cycle detected: ' + stack.concat([sopId]).join(' -> '));
    var sop = getSop(sopId);
    if (!sop) throw new Error('SOP not found: ' + sopId);
    var validation = exports.validate(sop);
    if (!validation.ok) throw new Error(validation.errors.join(' '));
    stack.push(sopId);
    (sop.permissions || []).forEach(function (p) { requiredPermissions.push(p); });
    sop.steps.forEach(function (step) {
      if (step.type === 'call_sop') visit(step.sopId, lineage.concat([sopId]));
      else {
        if (step.permission) requiredPermissions.push(step.permission);
        flattened.push(Object.assign({}, clone(step), { sopId: sopId, lineage: lineage.concat([sopId]) }));
      }
    });
    stack.pop();
  }
  visit(rootId, []);
  return {
    rootSopId: rootId,
    steps: flattened,
    requiredPermissions: unique(requiredPermissions),
    hasApprovalGates: flattened.some(function (s) { return s.type === 'approval'; }),
    backgroundEligible: flattened.every(function (s) { return s.type === 'action'; })
  };
};

exports.execute = async function (rootId, getSop, options) {
  options = options || {};
  var plan = exports.plan(rootId, getSop);
  var granted = options.grantedPermissions || [];
  var missing = plan.requiredPermissions.filter(function (p) { return granted.indexOf(p) === -1; });
  var run = {
    id: options.runId || ('run_' + Date.now().toString(36)),
    rootSopId: rootId,
    status: missing.length ? 'blocked' : 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    currentStep: 0,
    missingPermissions: missing,
    events: []
  };
  if (missing.length) return run;
  var startAt = options.startAt || 0;
  for (var i = startAt; i < plan.steps.length; i++) {
    var step = plan.steps[i];
    run.currentStep = i;
    if (step.type === 'approval' && !(options.approvedStepIds || []).includes(step.id)) {
      run.status = 'awaiting_approval';
      run.events.push({ stepId: step.id, status: 'awaiting_approval', at: new Date().toISOString() });
      return run;
    }
    if (step.type === 'approval') {
      run.events.push({ stepId: step.id, status: 'approved', at: new Date().toISOString() });
      continue;
    }
    if (step.type === 'instruction') {
      run.status = 'awaiting_user';
      run.events.push({ stepId: step.id, status: 'awaiting_user', at: new Date().toISOString() });
      return run;
    }
    var adapter = options.adapters && options.adapters[step.adapter];
    if (!adapter || typeof adapter.run !== 'function') {
      run.status = 'blocked';
      run.events.push({ stepId: step.id, status: 'unsupported_adapter', adapter: step.adapter, at: new Date().toISOString() });
      return run;
    }
    try {
      var output = await adapter.run(clone(step.input || {}), { runId: run.id, step: clone(step) });
      run.events.push({ stepId: step.id, status: 'completed', output: output, at: new Date().toISOString() });
    } catch (error) {
      run.status = 'failed';
      run.events.push({ stepId: step.id, status: 'failed', error: error.message || String(error), at: new Date().toISOString() });
      run.finishedAt = new Date().toISOString();
      return run;
    }
  }
  run.currentStep = plan.steps.length;
  run.status = 'completed';
  run.finishedAt = new Date().toISOString();
  return run;
};

exports.createId = function (prefix) {
  return (prefix || 'sop') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
};
