(function () {
  var $ = require('jquery'), ipc = require('electron').ipcRenderer, ls = require('local-storage'), stackFunctions = require('../helper/stack_functions');
  var page = location.pathname.split('/').pop();
  var icon = function (body) { return '<svg class="nav-icon" viewBox="0 0 20 20" aria-hidden="true">' + body + '</svg>'; };
  var items = [
    ['stack.html', 'Tasks', icon('<rect x="3" y="3" width="14" height="14" rx="2"/><path d="M6 7h8M6 10h8M6 13h5"/>')],
    ['report.html', 'Productivity', icon('<path d="M3 16V4M3 16h14M5 13l3-4 3 2 4-6"/>')],
    ['sops.html', 'SOPs', icon('<path d="M5 3h7l3 3v11H5zM12 3v4h3M7 10h6M7 13h6"/>')],
    ['taskLists.html', 'Lists', icon('<path d="M4 5h12M4 10h12M4 15h12"/>')]
  ];
  var $bar = $('<nav class="global-topbar" aria-label="Main navigation"><div class="global-nav-left"><button id="addButton" class="global-nav-action" type="button" aria-label="New task" title="New task">' + icon('<path d="M10 4v12M4 10h12"/>') + '</button><button id="timeButton" class="global-nav-action" type="button" aria-label="Clock in or out" title="Clock in or out">' + icon('<circle cx="10" cy="10" r="7"/><path d="M10 6v4l3 2"/>') + '</button></div><div class="global-nav-items"></div><div class="global-nav-right"><button id="settingsButton" class="global-nav-settings" type="button" aria-label="Settings" title="Settings">' + icon('<circle cx="10" cy="10" r="3"/><path d="M10 2v2M10 16v2M2 10h2M16 10h2"/>') + '</button><button id="logout" class="global-nav-logout" type="button" aria-label="Logout" title="Logout">' + icon('<path d="M9 3H4v14h5M12 6l4 4-4 4M7 10h9"/>') + '</button></div></nav>');
  items.forEach(function (item) { $bar.find('.global-nav-items').append('<button class="global-nav-item' + (item[0] === page ? ' is-active' : '') + '" data-page="' + item[0] + '" aria-label="' + item[1] + '" title="' + item[1] + '">' + item[2] + '</button>'); });
  $('body').prepend($bar);
  $bar.find('#timeButton').toggleClass('is-running', stackFunctions.isClockedIn());
  $bar.on('click', '.global-nav-item', function () { location.replace('./' + $(this).data('page')); });
  if (page !== 'stack.html') {
    $bar.find('#addButton').on('click', function () { ls('createPage', 'add'); location.replace('./createTask.html'); });
    $bar.find('#timeButton').on('click', function () { var i = parseInt(ls('currIndex'), 10) || 0; if (stackFunctions.isClockedIn()) stackFunctions.clockOut(); else stackFunctions.clockIn(i); $(this).toggleClass('is-running', stackFunctions.isClockedIn()); });
    $bar.find('#settingsButton').on('click', function () { location.replace('./settings.html'); });
    $bar.find('#logout').on('click', function () { var leave = function () { ipc.invoke('window:set-size', 'standard').finally(function () { location.replace('../home.html'); }); }; if (stackFunctions.isClockedIn()) stackFunctions.clockOut(leave); else leave(); });
  }
}());
