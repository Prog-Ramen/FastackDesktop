(function () {
  var path = location.pathname.split('/').pop();
  var contexts = {
    'stack.html': [['Alt+↑/↓','Select task'],['Alt+Enter','Open details'],['Alt+C','Clock in / transfer'],['Alt+V','Clock out'],['Alt+N','New task'],['Alt+P','Complete task']],
    'createTask.html': [['Enter','Create task'],['Alt+Backspace','Back'],['Tab / Shift+Tab','Move fields']],
    'taskDetail.html': [['Alt+E','Edit task'],['Alt+C','Clock in'],['Alt+V','Clock out'],['Alt+Backspace','Back']],
    'report.html': [['Alt+←/→','Change range'],['Alt+Backspace','Back']],
    'settings.html': [['Tab / Shift+Tab','Move controls'],['Alt+Backspace','Back']],
    'sops.html': [['Alt+↑/↓','Select SOP'],['Alt+Enter','Open SOP'],['Alt+N','New SOP'],['Alt+E','Edit SOP'],['Alt+P','Delete SOP'],['Alt+Backspace','Back']],
    'taskLists.html': [['Alt+↑/↓','Select task list'],['Alt+Enter','Open task list'],['Alt+N','New task list'],['Alt+E','Rename task list'],['Alt+P','Delete task list'],['Alt+Backspace','Back']]
  };
  var rows = contexts[path] || [['Alt+Backspace','Back']];
  var style = document.createElement('style');
  style.textContent = '.shortcut-compass-button{position:fixed;right:10px;bottom:10px;z-index:90;width:28px;height:28px;border:1px solid rgba(255,255,255,.12);border-radius:50%;color:#dce7f4;background:rgba(23,30,39,.92);font:600 12px system-ui;cursor:pointer;box-shadow:0 5px 18px rgba(0,0,0,.35)}.shortcut-compass{position:fixed;right:10px;bottom:44px;z-index:89;width:min(250px,calc(100vw - 20px));padding:10px;border:1px solid rgba(255,255,255,.1);border-radius:12px;background:rgba(18,24,32,.97);box-shadow:0 14px 36px rgba(0,0,0,.55);font:11px/1.4 system-ui;color:#d9e0e9}.shortcut-compass[hidden]{display:none}.shortcut-compass h2{margin:0 0 7px;font-size:11px;color:#fff}.shortcut-compass-row{display:flex;justify-content:space-between;gap:10px;padding:5px 2px;border-top:1px solid rgba(255,255,255,.05)}.shortcut-compass kbd{white-space:nowrap;color:#9dc8ee;font:10px ui-monospace,monospace}';
  document.head.appendChild(style);
  var panel = document.createElement('aside'); panel.className = 'shortcut-compass'; panel.hidden = true; panel.setAttribute('aria-label','Keyboard shortcuts');
  panel.innerHTML = '<h2>Shortcut compass</h2>' + rows.map(function(r){return '<div class="shortcut-compass-row"><span>'+r[1]+'</span><kbd>'+r[0]+'</kbd></div>';}).join('') + '<div class="shortcut-compass-row"><span>Toggle compass</span><kbd>Alt+/</kbd></div>';
  var button = document.createElement('button'); button.type='button'; button.className='shortcut-compass-button'; button.textContent='?'; button.title='Shortcut compass (Alt+/)'; button.setAttribute('aria-label','Show shortcut compass');
  if (path === 'createTask.html' || path === 'settings.html' || path === 'taskDetail.html') button.style.bottom = '64px';
  function toggle(){ panel.hidden=!panel.hidden; button.setAttribute('aria-expanded', String(!panel.hidden)); }
  button.addEventListener('click',toggle); document.body.appendChild(panel); document.body.appendChild(button);
  window.FastackCompass={toggle:toggle};
})();
