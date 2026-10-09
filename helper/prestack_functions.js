const base64 = require('base-64');
var ls = require('local-storage');
var githubFunctions = require('../helper/github_functions');
var dropboxFunctions = require('../helper/dropbox_functions');
var gdriveFunctions = require('../helper/gdrive_functions');
var localFunctions = require('../helper/local_functions');

exports.lookForStackLocal = function (callback) {
  var repo = ls('repoName') || 'local';
  localFunctions.listFiles('', repo, function (err, entries) {
    if (err) return callback(err, null);
    var largestYear = 0;
    entries.forEach(function (e) {
      if (/^\d{4}$/.test(e.name)) {
        var y = parseInt(e.name, 10);
        if (y > largestYear) largestYear = y;
      }
    });
    if (largestYear === 0) return callback(null, null);
    localFunctions.listFiles('', repo + '/' + largestYear, function (err, entries) {
      if (err) return callback(err, null);
      var largestMonth = 0;
      entries.forEach(function (e) {
        if (/^\d{1,2}$/.test(e.name)) {
          var m = parseInt(e.name, 10);
          if (m > largestMonth) largestMonth = m;
        }
      });
      if (largestMonth === 0) return callback(null, null);
      localFunctions.listFiles('', repo + '/' + largestYear + '/' + largestMonth, function (err, entries) {
        if (err) return callback(err, null);
        var largestDay = 0;
        entries.forEach(function (e) {
          if (/^\d{1,2}$/.test(e.name)) {
            var d = parseInt(e.name, 10);
            if (d > largestDay) largestDay = d;
          }
        });
        if (largestDay === 0) return callback(null, null);
        localFunctions.getContent('', repo + '/' + largestYear + '/' + largestMonth + '/' + largestDay, function (err, results) {
          if (err) return callback(err, null);
          try {
            return callback(null, JSON.parse(results));
          } catch (e) {
            return callback(e, null);
          }
        });
      });
    });
  });
};

exports.lookForStackDropBox = function(callback) {
  dropboxFunctions.listFiles(ls('token'), "/" + ls('repoName'), function (err, contentArray) {
    if (err) {
      return callback(err, null);
    }
    largestYear = 0;
    var fileNum = contentArray.length;
    for (var fileCount = 0; fileCount < fileNum; fileCount++) {
      var fourDigits = /^\d{4}$/;
      if (fourDigits.test(contentArray[fileCount].name)) {
        if (parseInt(contentArray[fileCount].name) > largestYear) {
          largestYear = parseInt(contentArray[fileCount].name)
        }
      }
    }
    if (largestYear === 0) {
      return callback(null, null);
    }
    dropboxFunctions.listFiles(ls('token'), "/" + ls('repoName') + "/" + largestYear, function (err, contentArray) {
      if (err) {
        return callback(err, null);
      }
      largestMonth = 0;
      var fileNum = contentArray.length;
      for (var fileCount = 0; fileCount < fileNum; fileCount++) {
        var twoDigits = /^\d{1,2}$/;
        if (twoDigits.test(contentArray[fileCount].name)) {
          if (parseInt(contentArray[fileCount].name) > largestMonth) {
            largestMonth = parseInt(contentArray[fileCount].name)
          }
        }
      }
      if (largestMonth === 0) {
        return callback(null, null);
      }
      dropboxFunctions.listFiles(ls('token'), "/" + ls('repoName') + "/" + largestYear + "/" + largestMonth, function (err, contentArray) {
        if (err) {
          return callback(err, null);
        }
        largestDay = 0
        var fileNum = contentArray.length
        for (var fileCount = 0; fileCount < fileNum; fileCount++) {
          var twoDigits = /^\d{1,2}$/;
          if (twoDigits.test(contentArray[fileCount].name)) {
            if (parseInt(contentArray[fileCount].name) > largestDay) {
              largestDay = parseInt(contentArray[fileCount].name)
            }
          }
        }
        if (largestDay === 0) {
          return callback(null, null);
        } else {
          dropboxFunctions.getContent(ls('token'), "/" + ls('repoName') + "/" + largestYear + "/" + largestMonth + "/" + largestDay, function (err, results) {
            if (err) {
              console.log(err);
              return callback(err, null);
            }
            try {
              // Dropbox getContent already decodes to a utf-8 JSON string.
              var stack = JSON.parse(results);
              return callback(null, stack);
            } catch (e) {
              return callback(e, null);
            }
          });
        }
      });
    });
  });
}

exports.lookForStackGDrive = function(callback) {
  var repo = ls('repoName');
  gdriveFunctions.listFiles(ls('token'), repo, function (err, entries) {
    if (err) return callback(err, null);
    var largestYear = 0;
    entries.forEach(function (e) {
      if (/^\d{4}$/.test(e.name)) {
        var y = parseInt(e.name, 10);
        if (y > largestYear) largestYear = y;
      }
    });
    if (largestYear === 0) return callback(null, null);
    gdriveFunctions.listFiles(ls('token'), repo + "/" + largestYear, function (err, entries) {
      if (err) return callback(err, null);
      var largestMonth = 0;
      entries.forEach(function (e) {
        if (/^\d{1,2}$/.test(e.name)) {
          var m = parseInt(e.name, 10);
          if (m > largestMonth) largestMonth = m;
        }
      });
      if (largestMonth === 0) return callback(null, null);
      gdriveFunctions.listFiles(ls('token'), repo + "/" + largestYear + "/" + largestMonth, function (err, entries) {
        if (err) return callback(err, null);
        var largestDay = 0;
        entries.forEach(function (e) {
          if (/^\d{1,2}$/.test(e.name)) {
            var d = parseInt(e.name, 10);
            if (d > largestDay) largestDay = d;
          }
        });
        if (largestDay === 0) return callback(null, null);
        gdriveFunctions.getContent(ls('token'), repo + "/" + largestYear + "/" + largestMonth + "/" + largestDay, function (err, results) {
          if (err) return callback(err, null);
          try {
            return callback(null, JSON.parse(results));
          } catch (e) {
            return callback(e, null);
          }
        });
      });
    });
  });
};

exports.lookForStack = function(callback) {
    githubFunctions.getContent(ls('token'), ls('username'), "", ls('repoName'), function (err, contentArray) {
      if (err) {
        return callback(err, null);
      }
      largestYear = 0;
      var fileNum = contentArray.length;
      for (var fileCount = 0; fileCount < fileNum; fileCount++) {
        var fourDigits = /^\d{4}$/;
        if (fourDigits.test(contentArray[fileCount].name)) {
          if (parseInt(contentArray[fileCount].name) > largestYear) {
            largestYear = parseInt(contentArray[fileCount].name)
          }
        }
      }
      if (largestYear === 0) {
        return callback(null, null);
      }
      githubFunctions.getContent(ls('token'), ls('username'), largestYear, ls('repoName'), function (err, contentArray) {
        if (err) {
          return callback(err, null);
        }
        largestMonth = 0;
        var fileNum = contentArray.length;
        for (var fileCount = 0; fileCount < fileNum; fileCount++) {
          var twoDigits = /^\d{1,2}$/;
          if (twoDigits.test(contentArray[fileCount].name)) {
            if (parseInt(contentArray[fileCount].name) > largestMonth) {
              largestMonth = parseInt(contentArray[fileCount].name)
            }
          }
        }
        if (largestMonth === 0) {
          return callback(null, null);
        }
        githubFunctions.getContent(ls('token'), ls('username'), largestYear + "/" + largestMonth, ls('repoName'), function (err, contentArray) {
          if (err) {
            return callback(err, null);
          }
          largestDay = 0
          var fileNum = contentArray.length
          for (var fileCount = 0; fileCount < fileNum; fileCount++) {
            var twoDigits = /^\d{1,2}$/;
            if (twoDigits.test(contentArray[fileCount].name)) {
              if (parseInt(contentArray[fileCount].name) > largestDay) {
                largestDay = parseInt(contentArray[fileCount].name)
              }
            }
          }
          if (largestDay === 0) {
            return callback(null, null);
          } else {
            githubFunctions.getContent(ls('token'), ls('username'), largestYear + "/" + largestMonth + "/" + largestDay, ls('repoName'), function (err, results) {
              if (err) {
                console.log(err);
                return callback(err, null);
              } else {
                stack = JSON.parse(base64.decode(results['content']));
                console.log(stack);
                return callback(null, stack); 
              }
            });
          }
        });
      });
    });
  }
