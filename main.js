const {app, BrowserWindow, ipcMain, Tray, nativeImage} = require('electron')
const path = require('path')


const assetsDir = path.join(__dirname, 'assets')

let tray = undefined
let window = undefined

// This method is called once Electron is ready to run our code
// It is effectively the main method of our Electron app
app.on('ready', () => {

  // Setup the menubar with an icon
  let icon = nativeImage.createFromDataURL(base64Icon);
  tray = new Tray('./images/va@2x.png');


  // Add a click handler so that when the user clicks on the menubar icon, it shows
  // our popup window
  tray.on('click', function(event) {
    toggleWindow();

    // Show devtools when command clicked
    if (window.isVisible() && process.defaultApp && event.metaKey) {
      window.openDevTools({mode: 'detach'})
    }
  });

  // Make the popup window for the menubar
  window = new BrowserWindow({
    width: 300,
    height: 500,
    show: false,
    frame: false,
    resizable: true,
    transparent: true,
    hasShadow: false
  });
  // Tell the popup window to load our login.html file
  window.loadURL(`file://${path.join(__dirname, './login.html')}`);

  // Only close the window on blur if dev tools isn't opened
  window.on('blur', () => {
    if(!window.webContents.isDevToolsOpened()) {
      window.hide()
    }
  })
});

const toggleWindow = () => {
  if (window.isVisible()) {
    window.hide()
  } else {
    showWindowbef()
  }
};


const showWindowbef = () => {
  const trayPos = tray.getBounds();
  const windowPos = window.getBounds();
  let x, y = 0
  if (process.platform == 'darwin') {
    x = Math.round(trayPos.x + (trayPos.width / 2) - (windowPos.width / 2));
    y = Math.round(trayPos.y + trayPos.height)
  } else {
    x = Math.round(trayPos.x + (trayPos.width / 2) - (windowPos.width / 2));
    y = Math.round(trayPos.y + trayPos.height * 10)
  }


  window.setPosition(x, y, false);
  window.show();
  window.focus()
};


ipcMain.on('show-window', () => {
  showWindow()
});



app.on('window-all-closed', () => {
  // On macOS it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit()
  }
});

// Tray Icon as Base64 so tutorial has less overhead
let base64Icon = `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAYCAYAAACbU/80AAAACXBIWXMAAC4jAAAuIwF4pT92AAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAbhJREFUeNpiYhhgwESpAcIr5hlQop+RDAsTgJQ/EDsAsQCa9AEgXgjEG95GJH2gqgOAFgcAqX4gViBCOcjyRKAjNlAlCoCWNwCp9URazgANmfVAffMpdgDU8noyoziBkCOYCFjuQIHlyI4IIDcE6qmU2/pJdgA0ezmQY5scNw+DjoAQspACNPeQFAIB5FhuLSbBsN/dn+EAEIMcggTsSXUAhoZIRRWGdDUtnBpA8hsdPRn4WdkYrnx4x/Do6xeUUMCmh4UU3002swXTugLCDDmnDqPItRqawx234v4dhurzJ9G1O1BcFOdCLY1ACgmQbxfZOMP5XVcvgB338fcvbIUTSSGAoWE50GewkAD5GBLsqvAEB3IgTA0WcIHUEDiITRBkwQqoJSBHgCwH+dZh50Z8lpPlAJzlOCiIYY4AJTZHoOUgmgBYSHJlBC1GE/BluSvv32GLb3RwAFgxOZKTCAtxJR4QOPrqBTGWf4CaQ3pRDK3THfE5gghQCDTnAtm1IVQzOY4AqQ8E6l9AcXsA6ghFIJ5ApOUgSw2JaZCQ0yQTgNYT9mjF6wMgvghtjj1gGCqAaaAdABBgAKMnmwocnYhOAAAAAElFTkSuQmCC`;