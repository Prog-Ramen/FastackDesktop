
const remote = require('@electron/remote');
const {globalShortcut} = remote;
const { BrowserWindow } = require('@electron/remote');
const path = require('path');
const $ = require('jquery');
const Prism = require('prismjs');
const codeSyntaxHighlight = require('@toast-ui/editor-plugin-code-syntax-highlight/dist/toastui-editor-plugin-code-syntax-highlight-all.js');
const Editor = require('@toast-ui/editor');
const chart = require('@toast-ui/editor-plugin-chart');
const uml = require('@toast-ui/editor-plugin-uml');
const colorSyntax = require('@toast-ui/editor-plugin-color-syntax');
const tableMergedCell = require('@toast-ui/editor-plugin-table-merged-cell');
const electron = require('electron');
const base64 = require('base-64');
var ls = require('local-storage')
var ipcRenderer = require('electron').ipcRenderer;
var githubFunctions = require('../helper/github_functions');
var cryptoHelper = require('../helper/crypto_helper');

var window = BrowserWindow.getFocusedWindow();


$(document).ready(function () {
  
   var chartOptions = {      name: 'chart',
       maxWidth: 200,
       maxHeight: 300}
    var plugins = [[chart, chartOptions], [codeSyntaxHighlight, { highlighter: Prism }], colorSyntax, tableMergedCell, uml];
  const viewer = Editor.factory({
    el: document.querySelector('#editSectionViewer'),
    viewer: true,
    height: '500px',
    plugins: plugins
  });
  setTimeout(function(){
    $("button:contains('Preview')").click();
  }, 1000);

  ipcRenderer.on('get_data_write', function(event, store){
    viewer.setMarkdown(store);
  })
});
