const remote = require('@electron/remote');
const {BrowserWindow, globalShortcut} = remote;
const electron = require('electron');;
var {ipcRenderer} = remote;
const {desktopCapturer, screen} = require('electron');
const Tesseract = require('tesseract.js');
var window = BrowserWindow.getFocusedWindow();
const screenshot = require('screenshot-desktop')
var recorder = 0;
var analyzedTextList = [];
var efficiencyMovingAverage= [];

   
var recognizeText = exports.recognizeText = function(base64Text, callback){
    const base64string = base64Text.split(',')[1];
    Tesseract.recognize(Buffer.from(base64string, 'base64'), 'eng')
    .progress((p) => {
      })
    .then(({ text }) => {
        return callback(text);
      });
}

/**
 * Create a screenshot of the entire screen using the desktopCapturer module of Electron.
 *
 * @param callback {Function} callback receives as first parameter the base64 string of the image
 * @param imageFormat {String} Format of the image to generate ('image/jpeg' or 'image/png')
 **/
var fullscreenScreenshot = exports.fullscreenScreenshot = function(callback) {
    screenshot({format: 'png'}).then((img) => {
        return callback(null, 'data:image/png;base64,' + img.toString('base64'));
      }).catch((err) => {
        return callback(err, null);
      })
}

function similarity(s1, s2) {
    var longer = s1;
    var shorter = s2;
    if (s1.length < s2.length) {
      longer = s2;
      shorter = s1;
    }
    var longerLength = longer.length;
    if (longerLength === 0) {
      return 1.0;
    }
    return (longerLength - editDistance(longer, shorter)) / parseFloat(longerLength);
  }

  function editDistance(s1, s2) {
    s1 = s1.toLowerCase();
    s2 = s2.toLowerCase();
  
    var costs = new Array();
    for (var i = 0; i <= s1.length; i++) {
      var lastValue = i;
      for (var j = 0; j <= s2.length; j++) {
        if (i == 0)
          costs[j] = j;
        else {
          if (j > 0) {
            var newValue = costs[j - 1];
            if (s1.charAt(i - 1) != s2.charAt(j - 1))
              newValue = Math.min(Math.min(newValue, lastValue),
                costs[j]) + 1;
            costs[j - 1] = lastValue;
            lastValue = newValue;
          }
        }
      }
      if (i > 0)
        costs[s2.length] = lastValue;
    }
    return costs[s2.length];
  }

var getDifferences = exports.getDifferences = function(){
    if (analyzedTextList.length >= 2){
        if (efficiencyMovingAverage.length <= 5){
            efficiencyMovingAverage.push(Math.round(similarity(analyzedTextList[analyzedTextList.length-1], analyzedTextList[analyzedTextList.length-2])*10000)/100);
        } else {
            var subArray = efficiencyMovingAverage.slice(0,5);
            var total = 0;
            for(var i = 0; i < 5; i++) {
                total += subArray[i];
            }
            var avg = total / 5;
            efficiencyMovingAverage.shift();
            efficiencyMovingAverage.shift();
            efficiencyMovingAverage.shift();
            efficiencyMovingAverage.shift();
            efficiencyMovingAverage[0] = avg;
        }
    }
    console.log(efficiencyMovingAverage);
}

exports.startRecordingText = function(){
    recorder = setInterval(function(){ 
        fullscreenScreenshot(function(err, data){
            recognizeText(data,function(result){
                if (analyzedTextList.length == 15){
                    analyzedTextList.shift();
                }
                analyzedTextList.push(result);
                getDifferences();
            })
        });
    }, 10000);    
}

exports.stopRecordingText = function(){
    if (recorder != 0){
        clearInterval(recorder);
    }
}
