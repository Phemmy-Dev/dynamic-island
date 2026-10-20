const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settingsApi', {
  // -> settings plus { startWithWindows, weather }
  get: () => ipcRenderer.invoke('settings:get'),
  set: (partial) => ipcRenderer.send('settings:set', partial),
  setStartWithWindows: (on) => ipcRenderer.send('settings:set-startup', on),
  onChanged: (callback) => ipcRenderer.on('settings:changed', (_event, s) => callback(s)),
  onWeather: (callback) => ipcRenderer.on('settings:weather', (_event, w) => callback(w)),
  onStartup: (callback) => ipcRenderer.on('settings:startup', (_event, on) => callback(on)),
});
