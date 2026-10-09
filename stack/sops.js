var repo = require('../helper/sop_repository');
var engine = require('../helper/sop_engine');
var $ = require('jquery');
var ls = require('local-storage');
var currentId = null;
var sourceTaskName = null;
var selectedIndex = 0;
var lastShortcut = { key: null, at: 0 };
require('electron').ipcRenderer.on('window-layout-changed', function (_event, layout) { if (layout && layout.preset) ls('windowSizePreset', layout.preset); });

function esc(v) { return String(v || '').replace(/[&<>"']/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }
function showList() { $('#sopEditor,#sopDetail').hide(); $('#sopList').show(); renderList(); }
function renderList() {
  var query = String($('#sopSearch').val() || '').trim().toLowerCase();
  var sops = repo.list().filter(function(s) {
    if (!query) return true;
    return [s.title, s.purpose, (s.categoryPath || []).join(' / '), (s.sourceTaskNames || []).join(' ')].join(' ').toLowerCase().indexOf(query) !== -1;
  });
  $('#sopList').html(sops.length ? sops.map(function(s){
    return '<article class="sop-row" tabindex="0" data-id="'+esc(s.id)+'"><h2>'+esc(s.title)+'</h2><p>'+esc((s.categoryPath||[]).join(' / ') || 'Unfiled')+' · v'+s.version+' · '+s.steps.length+' steps</p></article>';
  }).join('') : '<div class="sop-empty">No matching SOPs.<br>Try a different name, folder, or keyword.</div>');
  selectSop(Math.min(selectedIndex, Math.max(0, sops.length - 1)), false);
}
function selectSop(index, focus) {
  var rows=$('.sop-row'); if(!rows.length)return;
  selectedIndex=Math.max(0,Math.min(index,rows.length-1));
  rows.removeClass('is-key-selected').attr('aria-selected','false');
  rows.eq(selectedIndex).addClass('is-key-selected').attr('aria-selected','true');
  if(focus!==false)rows.eq(selectedIndex).focus();
}
function selectedSop() { var row=$('.sop-row').eq(selectedIndex); return row.length ? repo.get(row.data('id')) : null; }
function fillChildren(exclude) {
  var options=repo.list().filter(function(s){return s.id!==exclude;}).map(function(s){return '<option value="'+esc(s.id)+'">'+esc((s.categoryPath||[]).join(' / ') ? (s.categoryPath||[]).join(' / ')+' / '+s.title : s.title)+'</option>';}).join('');
  $('#childSop').html(options || '<option disabled>No SOPs available yet</option>');
  filterChildren();
}
function filterChildren() {
  var query = String($('#childSopSearch').val() || '').trim().toLowerCase();
  $('#childSop option').each(function() {
    var option = $(this), matches = !query || option.text().toLowerCase().indexOf(query) !== -1;
    option.toggle(matches);
  });
}
function openEditor() { currentId=null; sourceTaskName=null; $('#sopList,#sopDetail').hide(); $('#sopEditor').show(); $('#sopTitle,#sopPath,#sopPurpose,#sopSteps').val(''); $('#approvalGate').prop('checked',false); $('#sopError').text(''); fillChildren(); var stack=ls('stack')||{}; $('#prefillTask').toggle(!!(stack.incomplete&&stack.incomplete.length)).text('Use current task'); $('#sopTitle').focus(); }
function editSelected() {
  var sop=selectedSop() || repo.get(currentId); if(!sop)return;
  currentId=sop.id; sourceTaskName=(sop.sourceTaskNames||[])[0]||null;
  $('#sopList,#sopDetail').hide(); $('#sopEditor').show();
  $('#sopTitle').val(sop.title||''); $('#sopPath').val((sop.categoryPath||[]).join(' / ')); $('#sopPurpose').val(sop.purpose||'');
  $('#sopSteps').val((sop.steps||[]).filter(function(step){return step.type==='instruction';}).map(function(step){return step.instruction||step.title;}).join('\n'));
  $('#approvalGate').prop('checked',(sop.steps||[]).some(function(step){return step.type==='approval';})); $('#sopError').text('');
  fillChildren(sop.id); $('#childSop').val((sop.steps||[]).filter(function(step){return step.type==='call_sop';}).map(function(step){return step.sopId;}));
  $('#prefillTask').hide(); $('#sopTitle').focus();
}
function showDetail(id) {
  var sop=repo.get(id); if(!sop)return; currentId=id;
  try {
    var plan=engine.plan(id,repo.get); var badges=plan.requiredPermissions.map(function(p){return '<span class="sop-badge">'+esc(p)+'</span>';}).join('');
    var steps=plan.steps.map(function(step,i){return '<div class="sop-step"><small>'+(i+1)+' · '+esc(step.type)+' · '+esc(repo.get(step.sopId).title)+'</small><br>'+esc(step.title||step.instruction||step.adapter||'Approval required')+'</div>';}).join('');
    $('#sopDetail').html('<div class="sop-detail-head"><div><h2>'+esc(sop.title)+'</h2><p>'+esc((sop.categoryPath||[]).join(' / '))+' · version '+sop.version+'</p></div><span class="sop-badge">'+(plan.backgroundEligible?'Background ready':'Human-guided')+'</span></div><p style="font-size:10px;color:#aeb8c7">'+esc(sop.purpose||'No purpose recorded.')+'</p>'+badges+steps+'<div class="sop-detail-actions"><button id="createTaskFromSop" class="sop-primary">Create task</button><button id="dryRun" class="sop-primary">Dry run</button><button id="deleteSop" class="sop-secondary">Delete</button><button id="closeDetail" class="sop-secondary">Close</button></div><div id="runResult" class="sop-error"></div>').show();
    $('#sopList,#sopEditor').hide();
  } catch(e){ $('#sopError').text(e.message); }
}
$(document).ready(function(){
  repo.syncFromCloud(function(){ renderList(); });
  $('#sopSearch').on('input', renderList);
  $('#childSopSearch').on('input', filterChildren);
  $('#newSop').on('click',openEditor); $('#cancelSop').on('click',showList);
  $('#sopList').on('click','.sop-row',function(){selectedIndex=$(this).index();showDetail($(this).data('id'));});
  $('#prefillTask').on('click',function(){var stack=ls('stack')||{},task=stack.incomplete&&stack.incomplete[ls('currIndex')||0]||stack.incomplete&&stack.incomplete[0];if(!task)return;sourceTaskName=task.taskName;$('#sopTitle').val(task.taskName);$('#sopPurpose').val(task.description||'Capture the repeatable process used to complete this task.');$(this).text('Task linked');});
  $('#saveSop').on('click',function(){
    var title=$('#sopTitle').val().trim(), lines=$('#sopSteps').val().split('\n').map(function(x){return x.trim();}).filter(Boolean), steps=[];
    lines.forEach(function(line){steps.push({id:engine.createId('step'),type:'instruction',title:line,instruction:line});});
    var children=$('#childSop').val()||[]; children.forEach(function(child){steps.push({id:engine.createId('step'),type:'call_sop',sopId:child,title:'Run '+repo.get(child).title});});
    if($('#approvalGate').prop('checked'))steps.push({id:engine.createId('step'),type:'approval',title:'Approve completion'});
    try { var saved=repo.save({id:currentId||engine.createId('sop'),title:title,purpose:$('#sopPurpose').val().trim(),categoryPath:$('#sopPath').val().split('/').map(function(x){return x.trim();}).filter(Boolean),sourceTaskNames:sourceTaskName?[sourceTaskName]:[],permissions:[],status:'draft',steps:steps}); repo.syncToCloud(function(err){ if(err) $('#sopError').text('Saved locally, but cloud sync failed: '+(err.message||err)); }); showDetail(saved.id); }
    catch(e){$('#sopError').text(e.message);}
  });
  $('#sopDetail').on('click','#closeDetail',showList).on('click','#deleteSop',function(){
    var parents=repo.findDependents(currentId), message='Permanently delete this SOP?';
    if(!parents.length){if(confirm(message)){repo.remove(currentId);showList();}return;}
    var list=parents.map(function(s){return '• '+s.title;}).join('\n');
    if(!confirm('This SOP is required directly or indirectly by:\n\n'+list+'\n\nContinue deleting the child SOP?'))return;
    var deleteParents=confirm('Delete the dependent parent SOPs too?\n\n'+list+'\n\nOK: delete all listed parents.\nCancel: keep them in an invalid state until edited.');
    repo.remove(currentId);
    if(deleteParents)parents.forEach(function(parent){repo.remove(parent.id);});
    repo.syncToCloud(function(err){ if(err) $('#sopError').text('Deleted locally, but cloud sync failed: '+(err.message||err)); });
    showList();
  }).on('click','#dryRun',function(){
    try {var p=engine.plan(currentId,repo.get);$('#runResult').css('color','#8ed8bb').text('Plan valid: '+p.steps.length+' executable steps · '+(p.backgroundEligible?'can run in background':'requires human interaction')+'.');}catch(e){$('#runResult').text(e.message);}
  });
  $('#sopDetail').on('click','#createTaskFromSop',function(){
    var sop=repo.get(currentId); if(!sop)return;
    var plan=engine.plan(currentId,repo.get);
    var notes='## Procedure\n\nSOP: **'+sop.title+'** (v'+sop.version+')\n\n'+plan.steps.map(function(step){return '- [ ] '+(step.title||step.instruction||('Run '+step.adapter));}).join('\n');
    ls('taskDraftFromSop',{sopId:sop.id,title:sop.title,description:sop.purpose||'',tags:'#sop',notes:notes});
    ls('createPage','add');
    window.location.replace('./createTask.html');
  });
  function runSopShortcut(command) {
    var now=Date.now();if(lastShortcut.key===command&&now-lastShortcut.at<300)return;lastShortcut={key:command,at:now};
    if (command==='NewTask') openEditor();
    else if (command==='ScrollTaskUp') selectSop(selectedIndex-1);
    else if (command==='ScrollTaskDown') selectSop(selectedIndex+1);
    else if (command==='OpenTask') { var sop=selectedSop(); if(sop)showDetail(sop.id); }
    else if (command==='EditTask') editSelected();
    else if (command==='PopTask') { var sopToDelete=selectedSop(); if(sopToDelete){showDetail(sopToDelete.id);$('#deleteSop').trigger('click');} }
    // Clock shortcuts are intentionally ignored: timers belong to tasks, not SOPs.
  }
  window.FastackContextShortcuts={scope:'sops',run:runSopShortcut};
  if(window.__fastackPendingContextShortcut&&window.__fastackPendingContextShortcut.scope==='sops'){
    var pending=window.__fastackPendingContextShortcut;window.__fastackPendingContextShortcut=null;runSopShortcut(pending.key);
  }
  $(document).on('keydown','.sop-row',function(event){if(event.key==='Enter'&&!event.altKey){event.preventDefault();showDetail($(this).data('id'));}});
  $(document).on('keydown',function(event){
    var command=null;
    if(event.altKey&&event.code==='KeyN')command='NewTask';
    else if(event.altKey&&event.key==='ArrowUp')command='ScrollTaskUp';
    else if(event.altKey&&event.key==='ArrowDown')command='ScrollTaskDown';
    else if(event.altKey&&event.key==='Enter')command='OpenTask';
    else if(event.altKey&&event.code==='KeyE')command='EditTask';
    else if(event.altKey&&event.code==='KeyP')command='PopTask';
    if(command){event.preventDefault();runSopShortcut(command);}
  });
});
