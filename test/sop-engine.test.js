const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../helper/sop_engine');
const repository = require('../helper/sop_repository');

function getter(sops) { return id => sops[id] || null; }

test('SOPs can compose other SOPs into a hierarchical execution plan', () => {
  const sops = {
    release: { id:'release', title:'Release', steps:[{id:'call',type:'call_sop',sopId:'validate'},{id:'publish',type:'action',adapter:'github',permission:'github:write',input:{file:'release'}}] },
    validate: { id:'validate', title:'Validate', steps:[{id:'test',type:'action',adapter:'tests',permission:'process:test'}] }
  };
  const plan = engine.plan('release', getter(sops));
  assert.deepEqual(plan.steps.map(s => s.id), ['test','publish']);
  assert.deepEqual(plan.requiredPermissions.sort(), ['github:write','process:test']);
  assert.equal(plan.backgroundEligible, true);
});

test('a parent SOP can require multiple child SOPs in order', () => {
  const sops = {
    parent:{id:'parent',title:'Parent',steps:[{id:'one',type:'call_sop',sopId:'first'},{id:'two',type:'call_sop',sopId:'second'}]},
    first:{id:'first',title:'First',steps:[{id:'first-step',type:'instruction',title:'First step'}]},
    second:{id:'second',title:'Second',steps:[{id:'second-step',type:'instruction',title:'Second step'}]}
  };
  assert.deepEqual(engine.plan('parent', getter(sops)).steps.map(step => step.id), ['first-step','second-step']);
});

test('cyclic SOP composition is rejected', () => {
  const sops = { a:{id:'a',title:'A',steps:[{id:'ab',type:'call_sop',sopId:'b'}]}, b:{id:'b',title:'B',steps:[{id:'ba',type:'call_sop',sopId:'a'}]} };
  assert.throws(() => engine.plan('a', getter(sops)), /cycle detected/);
});

test('execution blocks before adapters run when a permission is missing', async () => {
  let called = false;
  const sops = { a:{id:'a',title:'A',steps:[{id:'write',type:'action',adapter:'files',permission:'files:write'}]} };
  const run = await engine.execute('a', getter(sops), { grantedPermissions:[], adapters:{files:{run:async()=>{called=true;}}} });
  assert.equal(run.status, 'blocked');
  assert.deepEqual(run.missingPermissions, ['files:write']);
  assert.equal(called, false);
});

test('approval gates pause a run and permissioned adapters complete deterministically', async () => {
  const sops = { a:{id:'a',title:'A',steps:[{id:'approve',type:'approval',title:'Approve'},{id:'write',type:'action',adapter:'files',permission:'files:write',input:{value:2}}]} };
  const paused = await engine.execute('a', getter(sops), { grantedPermissions:['files:write'], adapters:{} });
  assert.equal(paused.status, 'awaiting_approval');
  const run = await engine.execute('a', getter(sops), { grantedPermissions:['files:write'], approvedStepIds:['approve'], adapters:{files:{run:async input => input.value * 2}} });
  assert.equal(run.status, 'completed');
  assert.equal(run.events.find(event => event.stepId === 'write').output, 4);
});

test('repository reports parent references before a hard delete', () => {
  const suffix = Date.now().toString(36);
  const child = repository.save({ id:'archived-child-'+suffix, title:'Archived child', steps:[{id:'kept',type:'instruction',title:'Retained step'}] });
  const parent = repository.save({ id:'archive-parent-'+suffix, title:'Parent', steps:[{id:'call-kept',type:'call_sop',sopId:child.id}] });
  assert.deepEqual(repository.findParents(child.id).map(sop => sop.id), [parent.id]);
  repository.remove(child.id);
  assert.equal(repository.get(child.id), null);
  assert.throws(() => engine.plan(parent.id, repository.get), /SOP not found/);
});

test('repository reports transitive dependent parents for deletion impact', () => {
  const suffix = Date.now().toString(36)+'-tree';
  const child = repository.save({id:'child-'+suffix,title:'Child',steps:[{id:'c',type:'instruction',title:'C'}]});
  const parent = repository.save({id:'parent-'+suffix,title:'Parent',steps:[{id:'pc',type:'call_sop',sopId:child.id}]});
  const grandparent = repository.save({id:'grand-'+suffix,title:'Grandparent',steps:[{id:'gp',type:'call_sop',sopId:parent.id}]});
  assert.deepEqual(repository.findDependents(child.id).map(sop=>sop.id),[parent.id,grandparent.id]);
});
