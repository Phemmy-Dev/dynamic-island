const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('island', {
  reportPillRect: (rect) => ipcRenderer.send('island:pill-rect', rect),
  onHover: (callback) => ipcRenderer.on('island:hover', (_event, inside) => callback(inside)),
  onBlur: (callback) => ipcRenderer.on('island:blur', () => callback()),
  // Messages from the background helpers: { type: 'state' | 'artwork' | 'system', ... }
  onHelperMessage: (callback) => ipcRenderer.on('helper:message', (_event, msg) => callback(msg)),
  // name: 'settings' | 'nightlight' | 'power' | 'snip' | 'lock'
  shortcut: (name) => ipcRenderer.send('island:shortcut', name),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (partial) => ipcRenderer.send('settings:set', partial),
  onSettings: (callback) => ipcRenderer.on('settings:changed', (_event, s) => callback(s)),
  openSettings: () => ipcRenderer.send('settings:open'),
});

contextBridge.exposeInMainWorld('media', {
  // command: 'toggle' | 'next' | 'prev'
  send: (command) => ipcRenderer.send('media:command', command),
  seek: (positionMs) => ipcRenderer.send('media:seek', positionMs),
  // track: { title, artist, album, durationMs } -> { synced, plain, instrumental } | { none } | { error }
  getLyrics: (track) => ipcRenderer.invoke('lyrics:get', track),
});

contextBridge.exposeInMainWorld('system', {
  setVolume: (level) => ipcRenderer.send('system:set-volume', level),
  toggleMute: () => ipcRenderer.send('system:toggle-mute'),
  setBrightness: (level) => ipcRenderer.send('system:set-brightness', level),
  // kind: 'wifi' | 'bluetooth'
  setRadio: (kind, on) => ipcRenderer.send('system:set-radio', kind, on),
});
