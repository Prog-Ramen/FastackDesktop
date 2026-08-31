
const { shell } = require('electron');
const { BrowserWindow } = require('@electron/remote');
const remote = require('@electron/remote');
const path = require('path');
const $ = require('jquery');
const electron = require('electron');
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
var authorization_url = "";
var TOKEN_URL = "https://server.samar.pw:3000/github/authenticate?code=";

var window = remote.getCurrentWindow();
// Clear only auth-related keys so user preferences (settings, key bindings) persist across logout.
['token', 'username', 'repoName', 'platform', 'stack', 'key', 'reponame', 'repoNameInput', 'createPage', 'currIndex']
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
    ls('token', '');
    ls('username', 'local');
    localFunctions.makeRepo('', 'local', function (err) {
      if (err) { console.log(err); return; }
      ls('repoName', 'local');
      ls('key', null);
      prestack.lookForStackLocal(function (err, stackValue) {
        if (err) console.log(err);
        ls('stack', stackValue ? stackValue : { 'complete': [], 'incomplete': [] });
        routeAfterLogin();
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
    ls('platform', buttonType);
    [authorization_url, TOKEN_URL] = get_auth_urls(buttonType)
    fetch(authorization_url, {
      method: 'GET',
      redirect: 'follow'
    })
      .then((response) => {
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.indexOf("application/json") !== -1) {
          response.json().then((json) => {
            if (json.hasOwnProperty('token')) {
              console.log(json.token);
              setTokenAndChangePage(json.token);
            }
          });
        } else {
          if (buttonType === "Dropbox") {
            dropbox_auth();

          } else {
            var authWindow = new BrowserWindow({ width: 800, height: 800, show: false, 'node-integration': false });
            authWindow.loadURL(authorization_url);
            remote.getCurrentWindow().hide();

            authWindow.show();
            runOAuthWindowFunctions(authWindow);
          }
        }
      });
  });

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
                  prestack.lookForStackDropBox(function (err, stackValue) {
                    if (err) {
                      $('#errorreponame').text("Cannot get the current stack from the repository: " + err.message);
                    }
                    ls('stack', stackValue ? stackValue : { 'complete': [], 'incomplete': [] });
                    routeAfterLogin();
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
    if (buttonType === "Github") {
      authorization_url = 'https://github.com/login/oauth/authorize?';
      authorization_url = authorization_url + 'client_id=' + ls('GITHUB_CLIENT_ID') + "&scope=repo";
    } else if (buttonType === "Dropbox") {
      authorization_url = "https://www.dropbox.com/oauth2/authorize?";
      TOKEN_URL = "https://server.samar.pw:3000/dropbox/authenticate?code=";
      authorization_url = authorization_url + 'client_id=' + ls('DROPBOX_CLIENT_ID') + "&response_type=code";
    } else if (buttonType === "Google") {
      var pkce = pkceChallenge(128);
      authorization_url = 'https://accounts.google.com/o/oauth2/auth?code_challenge=' + pkce.code_challenge + '&code_challenge_method=S256&redirect_uri=http://127.0.0.1:5000&scope=https://www.googleapis.com/auth/drive&';
      TOKEN_URL = "https://server.samar.pw:3000/google/authenticate?code_verifier=" + pkce.code_verifier + "&code=";
      authorization_url = authorization_url + 'client_id=' + ls('GOOGLE_CLIENT_ID') + "&response_type=code"
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
            ls('stack', stackValue ? stackValue : { 'complete': [], 'incomplete': [] });
            routeAfterLogin();
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
              ls('stack', stackValue ? stackValue : { 'complete': [], 'incomplete': [] });
              routeAfterLogin();
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



  function handleCallback(url, window) {
    console.log(url);
    var raw_code = /code=([^&]*)/.exec(url) || null;
    var code = (raw_code && raw_code.length > 1) ? raw_code[1] : null;
    var error = /\?error=(.+)$/.exec(url);
    console.log(code);

    // If there is a code, proceed to get token from github
    if (code) {
      getToken(code, function (result) {
        loggedIn = true;
        window.hide();
        setTokenAndChangePage(result)
      });
      return;
    } else if (error) {
      alert('Oops! Something went wrong and we couldn\'t' +
        'log you in using Github. Please try again.');
      return;
    }
  }

  function getToken(code, callback) {
    console.log(code);
    $.getJSON(TOKEN_URL + code, function (data) {
      console.log(data);
      if (data.token) {
        return callback(data.token);
      } else {
        console.log("Second click initialized");
        $('#github').click();
      }
    });
  }

  // Handle the response from GitHub
  function runOAuthWindowFunctions(window) {
    var loggedIn = false;

    window.webContents.on('did-redirect-navigation', function (event, oldUrl, newUrl) {
      //console.log(newUrl);
      //handleCallback(newUrl);
    });

    window.webContents.on('did-finish-load', function (event, url) {
      //window.hide();
      url = event.sender.getURL();
      if (url.includes("google")) {
        //var authWindow = new BrowserWindow({width: 800, height: 800, show: false, 'node-integration': false});
        handleCallback(url, window);
        //authWindow.show();
      } else {
        handleCallback(url, window);
      }


    });

    // Reset the authWindow on close
    window.on('close', function () {
      if (!loggedIn) {
        remote.getCurrentWindow().show();
      }
    }, false);
  }

});
