
const { shell } = require('electron');
const { BrowserWindow } = require('@electron/remote');
const remote = require('@electron/remote');
const path = require('path');
const $ = require('jquery');
const electron = require('electron');
const base64 = require('base-64');
var githubFunctions = require('./helper/github_functions');
var ls = require('local-storage');
var cryptoHelper = require('./helper/crypto_helper');
var prestack = require('./helper/prestack_functions');
var randomBytes = require('randombytes');
var authorization_url = "";
var TOKEN_URL = 'https://fastack.herokuapp.com/github/authenticate?code=';

var window = remote.getCurrentWindow();
ls.clear();
ls("GITHUB_CLIENT_ID", '442dbe2e6a65ceb60986');
ls("DROPBOX_CLIENT_ID", 'sd6zmtq7kdohuqh');
const AUTH_URL_PATH = 'https://api.github.com/authorizations';
var TOKEN = "";
/* Initial Page with github, dropbox, and google drive options */
$(document).ready(function() {
    
    $("#login input[type=submit]").click(function() {
      $("input[type=submit]", $(this).parents("form")).removeAttr("clicked");
      $(this).attr("clicked", "true");
    });

    $('#login').on('submit', function(evt) {
        evt.preventDefault();
        var buttonType = $("input[type=submit][clicked=true]").val();
        ls('platform', buttonType);
        if (buttonType === "Github") {
          authorization_url = 'https://github.com/login/oauth/authorize?';
          authorization_url = authorization_url + 'client_id=' + ls('GITHUB_CLIENT_ID') + "&scope=repo";
        } else if (buttonType === "Dropbox") {
          authorization_url = "https://www.dropbox.com/oauth2/authorize?";
          TOKEN_URL = "https://fastack.herokuapp.com/dropbox/authenticate?code=";
          authorization_url = authorization_url + 'client_id=' + ls('DROPBOX_CLIENT_ID') + "&response_type=code";
        }
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

                remote.getCurrentWindow().setAlwaysOnTop(true);
                setInterval(function(){
                  remote.getCurrentWindow().show();
                }, 100);
                shell.openExternal(authorization_url);
                $("#login").replaceWith("<form id=\"login\">\n" +
                  "        <center><p>Login to Dropbox and enter code here </p></center>\n" +
                  "        <center><input type=\"text\" id=\"codeValue\" placeholder=\"Authentication Code\"></center>\n" +
                  "        <br><center><span style=\"color:red\" id=\"errorincode\">    </span></center>" +
                  "        <center><input type=\"submit\" id=\"dropboxCode\" value=\"Submit Code\"></center>\n" +
                  "    </form>");
                $('#login').on('submit', function(evt) {
                  evt.preventDefault();
                  $("#errorincode").text("");
                  if ($("#codeValue").val() === ""){
                    $("#errorincode").text("Error: No code provided")
                  } else {
                    $.getJSON(TOKEN_URL+$("#codeValue").val(), function(data) {
                      console.log(data);
                      if (data.token){
                        ls('token', data.token);
                        ls('username', "fastack");
                        ls('repoName', 'default');

                        window.location.replace("./stack/stack_name.html");
                      } else {
                        $("#errorincode").text("Error: Code is invalid")
                      }
                    });
                  }

                })
              } else {
                var authWindow = new BrowserWindow({width: 800, height: 800, show: false, 'node-integration': false});
                authWindow.loadURL(authorization_url);
                remote.getCurrentWindow().hide();

                authWindow.show();
                runOAuthWindowFunctions(authWindow);
              }
            }
          });
    });

    function setTokenAndChangePage (result){
      ls("token", result);
      githubFunctions.getUsername(ls("token"), function(err, username){
        if (err){
          console.log(err);
        } else {
          ls("username", username);
          ls('repoName', "");
          githubFunctions.checkFastackRepoExists(ls('token'), ls('username'), function(err, result){
            console.log(result);
            if (result[0]){
              ls('encstackdata', true);
              console.log(result[0]);
              ls('repoName', result[0]);
              if (result[1]){
                ls('encryptedSecret', atob(result[1]));
                window.location.replace("./stack/stack_name.html");
              } else {
                ls('key', null);
                prestack.lookForStack(function (err, stackValue) {
                  if (err) {
                    $('#errorreponame').text("Cannot get the current stack from the repository: " + err.message);
                  }
                  ls('stack', stackValue?stackValue:{'complete':[], 'incomplete': []});
                  if (ls('stack')['incomplete'].length === 0) {
                    ls('createPage', 'add');
                    window.location.replace("./stack/createTask.html");
                  } else {
                    window.location.replace("./stack/stack.html");
                  }
                });
                
              }
            } else {
              console.log("SWITCHING");
              ls("reponame", "");
              ls("encstackdata", false);
              ls("stackpass", "");
              window.location.replace("./stack/stack_name.html");
            }
          });
        }
      });
    }



    function handleCallback (url, window) {
      console.log(url);
      var raw_code = /code=([^&]*)/.exec(url) || null;
      var code = (raw_code && raw_code.length > 1) ? raw_code[1] : null;
      var error = /\?error=(.+)$/.exec(url);
      console.log(code);

      // If there is a code, proceed to get token from github
      if (code) {
        getToken(code, function(result){
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

    function getToken(code, callback){
      console.log(code);
      $.getJSON(TOKEN_URL+code, function(data) {
	console.log(data);
        if (data.token){
          return callback(data.token);
        } else {
          console.log("Second click initialized");
          $('#github').click();
        }
      });
    }

    // Handle the response from GitHub
    function runOAuthWindowFunctions(window){
      var loggedIn = false;

      window.webContents.on('did-redirect-navigation', function (event, oldUrl, newUrl) {
        //console.log(newUrl);
        //handleCallback(newUrl);
      });

      window.webContents.on('did-finish-load',function(event, url){
	//window.hide();
	url = event.sender.getURL();
        if (url.includes("google")){
          //var authWindow = new BrowserWindow({width: 800, height: 800, show: false, 'node-integration': false});
          window.loadURL(url);
          window.show();
          runOAuthWindowFunctions(window);
          //authWindow.show();
        } else {
	  handleCallback(url, window);
        }


      });

      // Reset the authWindow on close
      window.on('close', function() {
        if(!loggedIn){
          remote.getCurrentWindow().show();
        }
      }, false);
    }

});
