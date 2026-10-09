
const { shell } = require('electron');
const { BrowserWindow } = require('@electron/remote');
const remote = require('@electron/remote');
const path = require('path');
const $ = require('jquery');
const electron = require('electron');
const { ipcRenderer } = electron;
const base64 = require('base-64');
const pkceChallenge = require("pkce-challenge").default;
var githubFunctions = require('./helper/github_functions');
var dropboxFunctions = require('./helper/dropbox_functions');
var gdriveFunctions = require('./helper/gdrive_functions');
var localFunctions = require('./helper/local_functions');
var migrate = require('./helper/migrate');
var ls = require('local-storage');
var cryptoHelper = require('./helper/crypto_helper');
var prestack = require('./helper/prestack_functions');
var randomBytes = require('randombytes');
var profileCache = require('./helper/profile_cache');
var taskMerge = require('./helper/task_merge');
var authorization_url = "";
var TOKEN_URL = "https://server.samar.pw:3000/github/authenticate?code=";
var oauthState = null;

var window = remote.getCurrentWindow();
// Clear only auth-related keys so user preferences (settings, key bindings) persist across logout.
['token', 'username', 'repoName', 'platform', 'key', 'reponame', 'repoNameInput', 'createPage', 'currIndex']
  .forEach(function (k) { ls.remove(k); });
ls("GITHUB_CLIENT_ID", '442dbe2e6a65ceb60986');
ls("DROPBOX_CLIENT_ID", 'sd6zmtq7kdohuqh');
ls("GOOGLE_CLIENT_ID", '577186891500-biss0kpvqpackbdihak7d8ajt6u18fme.apps.googleusercontent.com');
const AUTH_URL_PATH = 'https://api.github.com/authorizations';
var TOKEN = "";
/* Initial Page with github, dropbox, and google drive options */
$(document).ready(function () {

  $("#login button[type=submit], #login input[type=submit]").click(function () {
    $("button[type=submit], input[type=submit]", $(this).parents("form")).removeAttr("clicked");
    $(this).attr("clicked", "true");
  });

  // Route to createTask on the *very first* launch (never seen the tour AND no history),
  // otherwise land on stack. An empty stack after real use should still show the stack page,
  // not force the user into task creation.
  function routeAfterLogin() {
    var s = ls('stack') || {};
    var incomplete = (s.incomplete || []).length;
    var complete = (s.complete || []).length;
    var neverUsed = ls('tourSeen') !== true && incomplete === 0 && complete === 0;
    if (neverUsed) {
      ls('createPage', 'add');
      window.location.replace('./stack/createTask.html');
    } else {
      window.location.replace('./stack/stack.html');
    }
  }

  function goLocal() {
    ls('platform', 'Local');
    ls('activeWorkspace', 'Local|local|local');
    ls('token', '');
    ls('username', 'local');
    localFunctions.makeRepo('', 'local', function (err) {
      if (err) { console.log(err); return; }
      ls('repoName', 'local');
      ls('key', null);
      prestack.lookForStackLocal(function (err, stackValue) {
        if (err) console.log(err);
        var merged = taskMerge.mergeStacks(stackValue);
        localFunctions.readAllSnapshots('local').forEach(function (snapshot) {
          try { merged = taskMerge.mergeStacks(merged, JSON.parse(snapshot.content)); } catch (e) {}
        });
        var cached = profileCache.list();
        Object.keys(cached).forEach(function (key) {
          if (cached[key] && cached[key].stack) merged = taskMerge.mergeStacks(merged, cached[key].stack);
        });
        ls('stack', merged);
        writeLocalMirror(merged, routeAfterLogin);
      });
    });
  }

  // Support FASTACK_LOCAL=1 dev shortcut: main.js appends ?local=1 to the URL.
  if (new URLSearchParams(window.location.search).get('local') === '1') {
    goLocal();
    return;
  }

  // Push-to-cloud migration: settings page navigates here with ?migrate=<target>.
  // Auto-run the target's OAuth flow; setTokenAndChangePage / dropbox_auth then
  // detect ls('migrateTarget') and run the migration instead of the normal login flow.
  var migrateParam = new URLSearchParams(window.location.search).get('migrate');
  if (migrateParam) {
    ls('platform', migrateParam);
    var urls = get_auth_urls(migrateParam);
    authorization_url = urls[0]; TOKEN_URL = urls[1];
    if (migrateParam === 'Dropbox') {
      dropbox_auth();
    } else {
      var authWindow = new BrowserWindow({ width: 800, height: 800, show: false, 'node-integration': false });
      authWindow.loadURL(authorization_url);
      remote.getCurrentWindow().hide();
      authWindow.show();
      runOAuthWindowFunctions(authWindow);
    }
    return;
  }

  $('#local').on('click', function (evt) {
    evt.preventDefault();
    goLocal();
  });

  $('#login').on('submit', function (evt) {
    evt.preventDefault();
    var buttonType = $("button[type=submit][clicked=true], input[type=submit][clicked=true]").val();
    // Keep each provider/repository's last known stack locally. The login
    // screen must never erase another workspace's cached tasks.
    var previousStack = ls('stack');
    if (previousStack && ls('platform')) profileCache.save(ls('platform'), ls('username'), ls('repoName'), previousStack);
    ls('platform', buttonType);
    [authorization_url, TOKEN_URL] = get_auth_urls(buttonType)
    if (buttonType === "Github") {
      github_device_auth();
    } else if (buttonType === "Dropbox") {
      dropbox_auth();
    } else {
      var authWindow = new BrowserWindow({
        width: 800, height: 800, show: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, partition: 'persist:fastack-oauth' }
      });
      runOAuthWindowFunctions(authWindow);
      authWindow.loadURL(authorization_url);
      remote.getCurrentWindow().hide();
      authWindow.show();
    }
  });

  function github_device_auth() {
    var stopped = false;
    var pollTimer = null;
    ipcRenderer.invoke('github-device:start', ls('GITHUB_CLIENT_ID')).then(function (result) {
      if (!result || !result.ok) {
        var detail = result && (result.description || result.error) || 'Unknown error';
        if (result && result.error === 'device_flow_disabled') detail = 'Device Flow is disabled for the Fastack OAuth App. Enable it in GitHub OAuth App settings, then retry.';
        $('#errorpassword').text(detail);
        return;
      }
      $('#login').html(
        '<div class="device-auth">' +
        '<p>Enter this code in GitHub:</p>' +
        '<button type="button" id="githubDeviceCode" class="device-code" title="Copy code">' + result.userCode + '</button>' +
        '<p id="githubDeviceStatus">Waiting for authorization…</p>' +
        '<button type="button" id="githubDeviceOpen">Open GitHub</button>' +
        '<button type="button" id="githubDeviceCancel">Cancel</button>' +
        '</div>'
      );
      function openVerification() { shell.openExternal(result.verificationUri); }
      $('#githubDeviceOpen').on('click', openVerification);
      $('#githubDeviceCode').on('click', function () { electron.clipboard.writeText(result.userCode); $('#githubDeviceStatus').text('Code copied. Paste it into GitHub.'); });
      $('#githubDeviceCancel').on('click', function () { stopped = true; if (pollTimer) clearTimeout(pollTimer); window.location.reload(); });
      openVerification();
      var intervalMs = Math.max(5, result.interval) * 1000;
      function poll() {
        if (stopped) return;
        ipcRenderer.invoke('github-device:poll', { clientId: ls('GITHUB_CLIENT_ID'), deviceCode: result.deviceCode }).then(function (status) {
          if (status && status.ok && status.token) {
            stopped = true;
            $('#githubDeviceStatus').text('Authorized. Loading your tasks…');
            setTokenAndChangePage(status.token);
            return;
          }
          if (status && status.slowDown) intervalMs += 5000;
          if (status && status.error && !status.pending && !status.slowDown) {
            stopped = true;
            $('#githubDeviceStatus').text(status.description || status.error);
            return;
          }
          pollTimer = setTimeout(poll, intervalMs);
        }).catch(function (error) {
          stopped = true;
          $('#githubDeviceStatus').text('Authorization check failed: ' + (error.message || error));
        });
      }
      pollTimer = setTimeout(poll, intervalMs);
    });
  }

  function writeLocalMirror(stack, callback) {
    var now = new Date();
    var datePath = now.getFullYear() + '/' + (now.getMonth() + 1) + '/' + now.getDate();
    localFunctions.createUpdateFile('', 'local/' + datePath, JSON.stringify(stack || { incomplete: [], complete: [] }), callback || function () {});
  }

  function backfillDropboxHistory(repoName, cloudStack, done) {
    var snapshots = localFunctions.readAllSnapshots('local');
    if (!snapshots.length) return done(cloudStack);
    var today = new Date();
    var todayPath = today.getFullYear() + '/' + (today.getMonth() + 1) + '/' + today.getDate();
    var merged = taskMerge.mergeStacks(cloudStack);
    var localAll = null;
    snapshots.forEach(function (snapshot) {
      try {
        var parsed = JSON.parse(snapshot.content);
        localAll = taskMerge.mergeStacks(localAll, parsed);
        if (snapshot.datePath !== todayPath) dropboxFunctions.createUpdateFile(ls('token'), repoName + '/' + snapshot.datePath, snapshot.content, function () {});
      } catch (e) {}
    });
    if (localAll) merged = taskMerge.mergeStacks(merged, localAll);
    var payload = JSON.stringify(merged);
    dropboxFunctions.createUpdateFile(ls('token'), repoName + '/' + todayPath, payload, function (err) {
      if (err) console.error('[fastack] Dropbox history backfill failed:', err.message || err);
      done(merged);
    });
  }

  function backfillCloudHistory(provider, repoName, username, cloudStack, done) {
    var snapshots = localFunctions.readAllSnapshots('local');
    if (!snapshots.length) return done(cloudStack);
    var now = new Date(), todayPath = now.getFullYear() + '/' + (now.getMonth() + 1) + '/' + now.getDate();
    var merged = taskMerge.mergeStacks(cloudStack);
    var localAll = null;
    snapshots.forEach(function (s) {
      try { var parsed = JSON.parse(s.content); localAll = taskMerge.mergeStacks(localAll, parsed); if (s.datePath !== todayPath) write(s.datePath, s.content); } catch (e) {}
    });
    if (localAll) merged = taskMerge.mergeStacks(merged, localAll);
    write(todayPath, JSON.stringify(merged), function () { done(merged); });
    function write(path, content, cb) {
      var finish = cb || function () {};
      if (provider === 'Github') return githubFunctions.createUpdateFile(ls('token'), username, repoName, path, content, finish);
      return gdriveFunctions.createUpdateFile(ls('token'), repoName + '/' + path, content, finish);
    }
  }

  function dropbox_auth() {
    var showIntervalId = setInterval(function () {
      remote.getCurrentWindow().show();
    }, 10000);
    shell.openExternal(authorization_url);
    $("#login").replaceWith("<form id=\"login\">\n" +
      "        <center><p>Login to Dropbox and enter code here </p></center>\n" +
      "        <center><input type=\"text\" id=\"codeValue\" placeholder=\"Authentication Code\"></center>\n" +
      "        <br><center><span style=\"color:red\" id=\"errorincode\">    </span></center>" +
      "        <center><input type=\"submit\" id=\"dropboxCode\" value=\"Submit Code\"></center>\n" +
      "    </form>");
    $('#login').on('submit', function (evt) {
      evt.preventDefault();
      $("#errorincode").text("");
      if ($("#codeValue").val() === "") {
        $("#errorincode").text("Error: No code provided")
      } else {
        $.getJSON(TOKEN_URL + $("#codeValue").val(), function (data) {
          if (data.token) {
            clearInterval(showIntervalId);
            ls('token', data.token);
            ls('username', "fastack");
            if (ls('migrateTarget')) {
              runMigration(data.token, ls('migrateTarget'));
              return;
            }
            dropboxFunctions.checkFastackRepoExists(ls('token'), function (err, result) {
              console.log("checking for repo");
              console.log(result);
              if (err) {
                console.log(err);
              } else {
                if (result) {
                  ls('repoName', result);
                  var loadDropboxStack = function (finish) {
                    var now = new Date(), todayPath = '/' + result + '/' + now.getFullYear() + '/' + (now.getMonth() + 1) + '/' + now.getDate();
                    dropboxFunctions.getContent(ls('token'), todayPath, function (directErr, directText) {
                      if (!directErr && directText) { try { return finish(null, JSON.parse(directText)); } catch (e) {} }
                      prestack.lookForStackDropBox(finish);
                    });
                  };
                  loadDropboxStack(function (err, stackValue) {
                    if (err) {
                      $('#errorreponame').text("Cannot get the current stack from the repository: " + err.message);
                    }
                    ls('activeWorkspace', 'Dropbox|fastack|' + result);
                    ls('stack', stackValue ? stackValue : (profileCache.load('Dropbox', 'fastack', result) || { 'complete': [], 'incomplete': [] }));
                    backfillDropboxHistory(result, ls('stack'), function (merged) { ls('stack', merged); profileCache.save('Dropbox', 'fastack', result, merged); writeLocalMirror(merged, routeAfterLogin); });
                  });
                } else {
                  window.location.replace("./stack/stack_name_db.html");
                }
              }
            });
          } else {
            $("#errorincode").text("Error: Code is invalid")
          }
        });
      }

    })
  }

  function get_auth_urls(buttonType) {
    oauthState = randomBytes(24).toString('hex');
    if (buttonType === "Github") {
      authorization_url = 'https://github.com/login/oauth/authorize?';
      authorization_url = authorization_url + 'client_id=' + ls('GITHUB_CLIENT_ID') + "&scope=repo&state=" + encodeURIComponent(oauthState);
    } else if (buttonType === "Dropbox") {
      authorization_url = "https://www.dropbox.com/oauth2/authorize?";
      TOKEN_URL = "https://server.samar.pw:3000/dropbox/authenticate?code=";
      authorization_url = authorization_url + 'client_id=' + ls('DROPBOX_CLIENT_ID') + "&response_type=code&state=" + encodeURIComponent(oauthState);
    } else if (buttonType === "Google") {
      var pkce = pkceChallenge(128);
      authorization_url = 'https://accounts.google.com/o/oauth2/auth?code_challenge=' + pkce.code_challenge + '&code_challenge_method=S256&redirect_uri=http://127.0.0.1:5000&scope=https://www.googleapis.com/auth/drive&';
      TOKEN_URL = "https://server.samar.pw:3000/google/authenticate?code_verifier=" + pkce.code_verifier + "&code=";
      authorization_url = authorization_url + 'client_id=' + ls('GOOGLE_CLIENT_ID') + "&response_type=code&state=" + encodeURIComponent(oauthState)
    }
    return [authorization_url, TOKEN_URL]
  }

  function runMigration(token, platform) {
    var cloudRepoName = ls('migrateRepoName') || 'fastack-migrated';
    function afterMigration(err, res) {
      ls.remove('migrateTarget');
      ls.remove('migrateRepoName');
      if (err) {
        alert('Migration failed: ' + (err.message || err));
        window.location.replace('./stack/stack.html');
        return;
      }
      ls('platform', platform);
      ls('repoName', res.cloudRepo);
      ls('token', token);
      if (platform !== 'Github') ls('username', 'fastack');
      alert('Migration complete: uploaded ' + res.uploaded + ' file(s) to ' + res.cloudRepo);
      window.location.replace('./stack/stack.html');
    }
    if (platform === 'Github') {
      githubFunctions.getUsername(token, function (err, username) {
        if (err) { alert('Migration failed: could not fetch Github username'); return; }
        ls('username', username);
        migrate.pushLocalToCloud('Github', token, username, cloudRepoName, afterMigration);
      });
    } else {
      migrate.pushLocalToCloud(platform, token, null, cloudRepoName, afterMigration);
    }
  }

  function setTokenAndChangePage(result) {
    ls("token", result);
    var platform = ls('platform');
    if (ls('migrateTarget')) {
      runMigration(result, ls('migrateTarget'));
      return;
    }
    if (platform === "Google") {
      ls("username", "fastack");
      ls('repoName', "");
      gdriveFunctions.checkFastackRepoExists(ls('token'), function (err, repoName) {
        if (err) {
          console.log(err);
          return;
        }
        if (repoName) {
          ls('repoName', repoName);
          ls('key', null);
          prestack.lookForStackGDrive(function (err, stackValue) {
            if (err) {
              $('#errorreponame').text("Cannot get the current stack from the folder: " + (err.message || err));
            }
            ls('activeWorkspace', 'Google|google|' + ls('repoName'));
            ls('stack', stackValue ? stackValue : (profileCache.load('Google', 'google', ls('repoName')) || { 'complete': [], 'incomplete': [] }));
            backfillCloudHistory('Google', ls('repoName'), null, ls('stack'), function (merged) { ls('stack', merged); profileCache.save('Google', 'google', ls('repoName'), merged); writeLocalMirror(merged, routeAfterLogin); });
          });
        } else {
          ls("reponame", "");
          window.location.replace("./stack/stack_name_db.html");
        }
      });
      return;
    }
    githubFunctions.getUsername(ls("token"), function (err, username) {
      if (err) {
        console.log(err);
      } else {
        ls("username", username);
        ls('repoName', "");
        githubFunctions.checkFastackRepoExists(ls('token'), ls('username'), function (err, result) {
          console.log(result);
          if (result[0]) {
            ls('repoName', result[0]);
            ls('key', null);
          prestack.lookForStack(function (err, stackValue) {
              if (err) {
                $('#errorreponame').text("Cannot get the current stack from the repository: " + err.message);
              }
              ls('activeWorkspace', 'Github|' + username + '|' + result[0]);
              ls('stack', stackValue ? stackValue : (profileCache.load('Github', username, result[0]) || { 'complete': [], 'incomplete': [] }));
              backfillCloudHistory('Github', ls('repoName'), username, ls('stack'), function (merged) { ls('stack', merged); profileCache.save('Github', username, ls('repoName'), merged); writeLocalMirror(merged, routeAfterLogin); });
            });
          } else {
            console.log("SWITCHING");
            ls("reponame", "");
            window.location.replace("./stack/stack_name.html");
          }
        });
      }
    });
  }



  function handleCallback(url, window, onAuthenticated) {
    var parsed;
    try { parsed = new URL(url); } catch (e) { return false; }
    // 2FA and passkey pages can contain an encoded return URL with `code=`.
    // Only accept a top-level callback code after navigation has left GitHub.
    if (parsed.hostname === 'github.com' || parsed.hostname.endsWith('.github.com')) return false;
    var code = parsed.searchParams.get('code');
    var error = parsed.searchParams.get('error');
    var returnedState = parsed.searchParams.get('state');
    if ((code || error) && oauthState && returnedState !== oauthState) {
      $('#errorpassword').text('Authentication was rejected because its security state did not match. Please try again.');
      remote.getCurrentWindow().show();
      return true;
    }

    // If there is a code, proceed to get token from github
    if (code) {
      getToken(code, function (result) {
        if (!result) return;
        onAuthenticated();
        window.close();
        setTokenAndChangePage(result);
      });
      return true;
    } else if (error) {
      alert('Oops! Something went wrong and we couldn\'t' +
        'log you in using Github. Please try again.');
      return true;
    }
    return false;
  }

  function getToken(code, callback) {
    $.getJSON(TOKEN_URL + encodeURIComponent(code), function (data) {
      if (data.token) {
        return callback(data.token);
      } else {
        $('#errorpassword').text('GitHub authorized the app, but token exchange failed. Please try again.');
        remote.getCurrentWindow().show();
        return callback(null);
      }
    }).fail(function () {
      $('#errorpassword').text('Could not complete GitHub authentication. Check your connection and try again.');
      remote.getCurrentWindow().show();
      callback(null);
    });
  }

  // Handle the response from GitHub
  function runOAuthWindowFunctions(window) {
    var loggedIn = false;
    var callbackStarted = false;
    function inspect(url) {
      if (callbackStarted) return;
      callbackStarted = handleCallback(url, window, function () { loggedIn = true; }) || false;
    }
    // Keep GitHub's passkey/2FA auxiliary pages in this controlled auth window.
    window.webContents.setWindowOpenHandler(function (details) {
      window.loadURL(details.url);
      return { action: 'deny' };
    });
    window.webContents.on('will-navigate', function (_event, url) { inspect(url); });
    window.webContents.on('did-redirect-navigation', function (_event, url) { inspect(url); });
    window.webContents.on('did-navigate', function (_event, url) { inspect(url); });
    window.webContents.on('did-finish-load', function (event) { inspect(event.sender.getURL()); });

    // Reset the authWindow on close
    window.on('close', function () {
      if (!loggedIn) {
        remote.getCurrentWindow().show();
      }
    }, false);
  }

});
