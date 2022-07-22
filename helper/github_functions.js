const base64 = require('base-64');
const algorithm = 'aes-256-ctr';
var CryptoJS = require("crypto-js");
var cryptoHelper = require('./crypto_helper');
var async = require('async');
var GitHub = require('github-api');
var ls = require('local-storage');
var Repository = require('github-api/dist/components/Repository');
var gh = null;
var temp = require('temp');
var fs = require('fs');
var Dropbox = require('dropbox').Dropbox;

temp.track();

function createNewGithub(token){
  if (!gh){
    gh = new GitHub({
      token: token
    });
  }
}


exports.makeRepo = function(token, repoName, privateRepos, callback){
  fetch("https://api.github.com/user/repos", {
    method: 'POST',
    headers: {
      'Authorization' : 'token ' + token,
    },
    body: JSON.stringify({
      'name': repoName,
      'auto_init': true,
      'private': privateRepos,
      'gitignore_template': 'nanoc'
    })
  })
    .then((response) => {
      const isValid = response.status < 400;
      const body = response._bodyInit;
      response.json().then((json) => {
        if (isValid) {
          console.log("success");
          return callback(null, "success");
        } else {
          console.log(json);
          return callback(json.message, null);
        }
      });
    });
}

exports.getPlan = function(token, callback){
  fetch("https://api.github.com/user", {
    method: 'GET',
    headers: {
      'Authorization' : 'token ' + token,
    }
  })
    .then((response) => {
      const isValid = response.status < 400;
      const body = response._bodyInit;
      return response.json().then((json) => {
        if (isValid) {
          return callback(null, json.plan);
        } else {
          return callback(json.message, null);
        }
      });
    });
}
exports.getProfile = function(token, callback){
  createNewGithub(token);
  gh.getUser().getProfile(function(err, response){
    if (err) {
      return callback(err);
    } else {
      return callback(null, response);
    }
  });
};

exports.getPlan = function(token, callback){
  this.getProfile(token, function(err, profile){
    if (err){
      return callback(err);
    } else {
      return callback(null, profile.plan);
    }
  })
};

exports.getUsername = function(token, callback){
  this.getProfile(token, function(err, profile){
    if (err){
      return callback(err);
    } else {
      return callback(null, profile.login);
    }
  })
};


exports.getContent = function(token, username, filepath, repoName, callback){
  fetch("https://api.github.com/repos/" + username + "/" + repoName + "/contents/" + filepath, {
    method: 'GET',
    headers: {
      'Authorization': 'token ' + token,
    }
  }).then((response) => {
    const isValid = response.status < 400;
    const body = response._bodyInit;
    console.log(response.status);
    response.json().then((json) => {
      console.log(json);
      if (isValid) {
        json['repoName'] = repoName;
        return callback(null, json);
      } else {
        return callback(null, []);
      }
    });
  }).catch((error) => {
      return callback(null, []);
  });
}

exports.checkFastackRepoExists = function(token, username, callback){
  fetch("https://api.github.com/user/repos?affiliation=owner&per_page=100", {
    method: 'GET',
    headers: {
      'Authorization' : 'token ' + token,
      'affiliation': 'owner'
    }
  })
    .then((response) => {
      console.log(response);
      const isValid = response.status < 400;
      const body = response._bodyInit;
      response.json().then((json) => {
        if (isValid) {
          var nameArray = json.map(function(item) { return item.name});
          console.log(json);
          var temp = this;
          var found = false;
          async.map(nameArray, async.apply(this.getContent, token, username, ""), function(err, contentArray){
            console.log(contentArray.length);
	
            for (var repoCount = 0; repoCount < contentArray.length; repoCount++){
	      num_files = 0;
	      if (contentArray[repoCount]) {
                  num_files = contentArray[repoCount].length;
              } 
              for (var fileCount = 0; fileCount < num_files; fileCount++) {
                if (contentArray[repoCount][fileCount].name === username) {
                  found = true;
                  temp.getContent(token, username, username, json[repoCount].name, function(err, contentInfo){
                    if (err){
                      return callback('Unable to get file contents.', null);
                    }
                    return callback(null, [contentInfo['repoName'], contentInfo['content']]);
                  });
                } else if (repoCount === contentArray.length - 1 && fileCount === contentArray[repoCount].length - 1 && found === false){
                  console.log(found);
                  return callback(null, ["", ""]);
                }
              }
            }
          });
        } else {
          return callback(json.message, null);
        }
      });
    });
}

exports.checkFileExists = function(token, username, repoName, filename, callback){
  this.getContent(token, username, filename, repoName, function(err, contentArray){
    if (err){
      console.log(err);
      return callback(null, []);
    }
    return callback(null, contentArray);
  });
}



exports.createUpdateFile = function(token, username, repoName, filename, fileContent, callback){

  var create_url = "https://api.github.com/repos/" + username + "/" + repoName + "/contents/" + filename
  var auth_header = "token " + token;
  if (ls('platform') === "Dropbox"){
    var dropbox = new Dropbox({accessToken: token});
    dropbox.filesAlphaUpload({contents: fileContent, path: filename});
    return callback(null, "Successfully wrote " + filename);
  } else {
    this.checkFileExists(token, username, repoName, filename, function (err, exists){
      var options = {
        method: 'PUT',
        headers: {
          'Authorization': auth_header,
        },
        body: {
          'content': btoa(fileContent),
          'message': filename
        }
      };
      if (exists){
        options['body']['sha'] = exists.sha;
      }
      options['body'] = JSON.stringify(options['body']);
      fetch(create_url, options).then((response) => {
        const isValid = response.status < 400;
        const body = response._bodyInit;
        return response.json().then((json) => {
          if (isValid) {
            return callback(null, json);
          } else {
            return callback(json.message, null);
          }
        });
      });
    })
    
  }

};
