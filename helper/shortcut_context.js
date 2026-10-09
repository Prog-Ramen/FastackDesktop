var ENTITY_COMMANDS = ['NewTask', 'ScrollTaskUp', 'ScrollTaskDown', 'OpenTask', 'EditTask', 'PopTask', 'ClockIn', 'ClockOut'];

exports.route = function (pathname, command) {
  var page = String(pathname || '').split('/').pop();
  if (ENTITY_COMMANDS.indexOf(command) < 0) return { scope: 'global', page: page };
  if (page === 'taskLists.html') return { scope: 'lists', page: page };
  if (page === 'sops.html') return { scope: 'sops', page: page };
  if (page === 'stack.html' || page === 'taskDetail.html') return { scope: 'tasks', page: page };
  return { scope: 'none', page: page };
};

exports.entityCommands = ENTITY_COMMANDS.slice();
