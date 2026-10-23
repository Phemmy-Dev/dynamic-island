const { app, BrowserWindow, ipcMain, screen, shell, Tray, Menu, nativeImage, powerMonitor, globalShortcut } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const { startHelper } = require('./helper');
const { getLyrics } = require('./lyrics-source');
const { getWeather } = require('./weather');
const settingsStore = require('./settings-store');

// The window is a fixed transparent canvas big enough for the expanded island,
// flush with the top edge of the screen. Everything outside the island is
// click-through (see setIgnoreMouseEvents).
const WIN_WIDTH = 720; // wide enough for the media view with lyrics open
const WIN_HEIGHT = 220;

let win = null;
let settingsWin = null;
let ambientWin = null;
let tray = null;
let media = null;
let system = null;

function positionWindow() {
  if (!win) return;
  // Electron works in DIPs, so these numbers are already DPI-scaled.
  const { bounds } = screen.getPrimaryDisplay();
  const x = Math.round(bounds.x + (bounds.width - WIN_WIDTH) / 2);
  const y = bounds.y;
  // Pass width/height every time: moving across monitors with different
  // scale factors can otherwise resize the window.
  win.setBounds({ x, y, width: WIN_WIDTH, height: WIN_HEIGHT });
}

function createWindow() {
  win = new BrowserWindow({
    width: WIN_WIDTH,
    height: WIN_HEIGHT,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 'screen-saver' keeps it above most other topmost windows.
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true });
  positionWindow();

  win.loadFile('index.html');
  win.once('ready-to-show', () => win.showInactive());

  // The renderer may load after the first helper messages; replay the latest.
  win.webContents.on('did-finish-load', () => {
    for (const msg of lastMessages.values()) win.webContents.send('helper:message', msg);
  });
  // Surface renderer errors in the terminal that ran `npm start`.
  win.webContents.on('console-message', (e) => {
    if (e.level === 'error') console.error('[renderer]', e.message);
  });
  win.on('blur', () => win.webContents.send('island:blur'));
  win.on('closed', () => { win = null; });
}

// Hover tracking: poll the cursor and compare it to the pill's rect (reported
// by the renderer). Forwarded DOM mouse events are unreliable on Windows right
// after toggling click-through, so we don't use mouseenter/mouseleave.
// While the island is tucked, the cursor must rest on it this long before it
// reacts; until then it stays click-through so clicks reach the app below.
const TUCKED_REVEAL_MS = 300;

let pillRect = null;
let hovering = false;
let insideSince = 0;

ipcMain.on('island:pill-rect', (_event, rect) => { pillRect = rect; });

function checkHover() {
  if (!win || !pillRect) return;
  const p = screen.getCursorScreenPoint();
  const b = win.getBounds();
  const over =
    p.x >= b.x + pillRect.x && p.x <= b.x + pillRect.x + pillRect.width &&
    p.y >= b.y + pillRect.y && p.y <= b.y + pillRect.y + pillRect.height;
  if (!over) insideSince = 0;
  else if (!insideSince) insideSince = Date.now();
  const inside = over && (!pillRect.tucked || hovering || Date.now() - insideSince >= TUCKED_REVEAL_MS);
  if (inside === hovering) return;
  hovering = inside;
  // Only the pill catches clicks; everything else falls through to the desktop.
  if (inside) win.setIgnoreMouseEvents(false);
  else win.setIgnoreMouseEvents(true, { forward: true });
  win.webContents.send('island:hover', inside);
}

// Helpers: relay their messages to the renderer (keeping the latest of each
// type), and the renderer's commands back.
// Message types: 'state' + 'artwork' (media.ps1), 'system' (system.ps1),
// 'weather' (weather.js).
const lastMessages = new Map();

function relay(msg) {
  lastMessages.set(msg.type, msg);
  if (win) win.webContents.send('helper:message', msg);
  if (ambientWin) ambientWin.webContents.send('helper:message', msg);
  if (msg.type === 'weather' && settingsWin) settingsWin.webContents.send('settings:weather', msg);
}

ipcMain.on('media:command', (_event, command) => {
  if (media && ['toggle', 'next', 'prev'].includes(command)) media.send(command);
});

// Bring the app that's playing to the front. Uses the source app the media
// helper reported, not anything from the page.
ipcMain.on('media:open-source', () => {
  const source = (lastMessages.get('state') || {}).app;
  if (!source || !/^[\w .!-]+$/.test(source)) return;
  if (source.includes('!')) {
    // Store apps (e.g. Media Player) are opened by their app ID.
    spawn('explorer.exe', [`shell:AppsFolder\\${source}`], { detached: true, stdio: 'ignore' }).unref();
  } else if (system) {
    // Desktop apps report their exe ("Spotify.exe") or name ("Brave", "MSEdge").
    // shortcut: apps with a hashed ID (Firefox) won't match a process; map them if anyone asks.
    system.send(`focus ${source.replace(/\.exe$/i, '')}`);
  }
});

ipcMain.on('media:seek', (_event, positionMs) => {
  if (media && Number.isFinite(positionMs) && positionMs >= 0) media.send(`seek ${Math.round(positionMs)}`);
});

ipcMain.on('system:set-volume', (_event, level) => {
  if (system && typeof level === 'number' && Number.isFinite(level)) {
    system.send(`volume ${Math.min(1, Math.max(0, level)).toFixed(3)}`);
  }
});

ipcMain.on('system:toggle-mute', () => system && system.send('mute'));

ipcMain.on('system:set-brightness', (_event, level) => {
  if (system && typeof level === 'number' && Number.isFinite(level)) {
    system.send(`brightness ${Math.round(Math.min(100, Math.max(0, level)))}`);
  }
});

ipcMain.on('system:set-radio', (_event, kind, on) => {
  if (system && ['wifi', 'bluetooth'].includes(kind)) system.send(`radio ${kind} ${on ? 'on' : 'off'}`);
});

// Command centre shortcuts. Only these fixed targets can be opened.
const SHORTCUTS = {
  settings: () => shell.openExternal('ms-settings:'),
  island: () => openSettings(),
  nightlight: () => shell.openExternal('ms-settings:nightlight'),
  power: () => shell.openExternal('ms-settings:batterysaver'),
  snip: () => shell.openExternal('ms-screenclip:'),
  lock: () => spawn('rundll32.exe', ['user32.dll,LockWorkStation'], { detached: true, stdio: 'ignore' }).unref(),
};

// Lyrics for the current track (see lyrics-source.js).
ipcMain.handle('lyrics:get', async (_event, track) => {
  const str = (v) => (typeof v === 'string' ? v.slice(0, 300) : '');
  if (!track || !str(track.title)) return { none: true };
  try {
    return await getLyrics({
      title: str(track.title),
      artist: str(track.artist),
      album: str(track.album),
      durationMs: Number.isFinite(track.durationMs) ? track.durationMs : 0,
    });
  } catch {
    return { error: true };
  }
});

ipcMain.on('island:shortcut', (_event, name) => {
  if (Object.hasOwn(SHORTCUTS, name)) SHORTCUTS[name]();
});

// ---------- Settings ----------

// In development the app runs as `electron <folder>`, so the login item has to
// launch electron.exe with the project folder as its argument.
function loginItemOptions() {
  return app.isPackaged ? {} : { path: process.execPath, args: [app.getAppPath()] };
}

const startsWithWindows = () => app.getLoginItemSettings(loginItemOptions()).openAtLogin;

function setStartWithWindows(on) {
  app.setLoginItemSettings({ openAtLogin: !!on, ...loginItemOptions() });
  buildTrayMenu();
  if (settingsWin) settingsWin.webContents.send('settings:startup', startsWithWindows());
}

ipcMain.handle('settings:get', () => ({
  ...settingsStore.get(),
  startWithWindows: startsWithWindows(),
  weather: lastMessages.get('weather') || null,
}));

ipcMain.on('settings:set', (_event, partial) => settingsStore.update(partial));
ipcMain.on('settings:set-startup', (_event, on) => setStartWithWindows(on));
ipcMain.on('settings:open', () => openSettings());

settingsStore.onChange((current, previous) => {
  for (const w of [win, settingsWin, ambientWin]) if (w) w.webContents.send('settings:changed', current);
  if (!current.ambient) closeAmbient();
  if (current.weatherCity !== previous.weatherCity || current.weatherUnits !== previous.weatherUnits) {
    refreshWeather();
  }
});

function openSettings() {
  if (settingsWin) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  // Open below the island rather than centred, so its title bar isn't covered.
  const area = screen.getPrimaryDisplay().workArea;
  const width = 760;
  const height = Math.min(560, area.height - 90);
  settingsWin = new BrowserWindow({
    width,
    height,
    x: Math.round(area.x + (area.width - width) / 2),
    y: area.y + 70,
    minWidth: 620,
    minHeight: 420,
    // No separate title bar: the glass runs to the top, with Windows' own
    // minimize/maximize/close buttons drawn over it.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#ffffff', height: 34 },
    title: 'Dynamic Island Settings',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    // Windows 11 acrylic glass behind the page (settings.css keeps the page see-through).
    // Older Windows ignores this and shows the dark page background instead.
    backgroundColor: '#00000000',
    backgroundMaterial: 'acrylic',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'settings-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWin.setMenu(null);
  settingsWin.loadFile('settings.html');
  settingsWin.once('ready-to-show', () => settingsWin.show());
  settingsWin.webContents.on('console-message', (e) => {
    if (e.level === 'error') console.error('[settings]', e.message);
  });
  settingsWin.on('closed', () => { settingsWin = null; });
}

// ---------- Weather ----------

const WEATHER_REFRESH_MS = 15 * 60 * 1000;
let weatherRequest = 0;

async function refreshWeather() {
  const { weatherCity, weatherUnits } = settingsStore.get();
  const id = ++weatherRequest;
  if (!weatherCity) {
    relay({ type: 'weather', status: 'off' });
    return;
  }
  relay({ type: 'weather', status: 'loading', city: weatherCity });
  let msg;
  try {
    msg = await getWeather(weatherCity, weatherUnits);
  } catch {
    msg = { type: 'weather', status: 'error', city: weatherCity };
  }
  if (id === weatherRequest) relay(msg);  // ignore answers for an older city
}

// ---------- Now Playing screen ----------

// Full-screen "lock screen" look: big clock, album art, lyrics. It doesn't
// lock the PC (Windows keeps apps off the real lock screen).
let screenLocked = false;

function openAmbient() {
  if (!settingsStore.get().ambient) return;  // turned off in Settings
  if (ambientWin) {
    ambientWin.focus();
    return;
  }
  const { bounds } = screen.getPrimaryDisplay();
  ambientWin = new BrowserWindow({
    ...bounds,
    frame: false,
    fullscreen: true,
    skipTaskbar: true,
    backgroundColor: '#000000',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  ambientWin.setAlwaysOnTop(true, 'screen-saver');
  ambientWin.loadFile('ambient.html');
  ambientWin.webContents.on('did-finish-load', () => {
    for (const msg of lastMessages.values()) ambientWin.webContents.send('helper:message', msg);
  });
  ambientWin.webContents.on('console-message', (e) => {
    if (e.level === 'error') console.error('[ambient]', e.message);
  });
  ambientWin.once('ready-to-show', () => {
    ambientWin.show();
    ambientWin.focus();
    if (win) win.hide();  // the island would sit on top of the clock
  });
  ambientWin.on('closed', () => {
    ambientWin = null;
    if (win) win.showInactive();
  });
}

function closeAmbient() {
  if (ambientWin) ambientWin.close();
}

ipcMain.on('ambient:open', openAmbient);
ipcMain.on('ambient:close', closeAmbient);

// Open by itself after a while untouched, but only while music is playing,
// never over a full-screen video/game, and not while Windows is locked.
function checkIdleAmbient() {
  const media = lastMessages.get('state');
  const sys = lastMessages.get('system');
  if (ambientWin || screenLocked || !media || media.status !== 'Playing') return;
  if (sys && sys.fullscreen) return;
  if (powerMonitor.getSystemIdleTime() >= settingsStore.get().ambientIdleMin * 60) openAmbient();
}

// ---------- Tray ----------

function buildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Settings…', click: openSettings },
    { label: 'Start with Windows', type: 'checkbox', checked: startsWithWindows(), click: (item) => setStartWithWindows(item.checked) },
    { type: 'separator' },
    { label: 'Quit Dynamic Island', click: () => app.quit() },
  ]));
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
  tray = new Tray(icon);
  tray.setToolTip('Dynamic Island');
  buildTrayMenu();
  // Left-click shows the same menu as right-click.
  tray.on('click', () => tray.popUpContextMenu());
}

// Our own app ID: names the startup entry ("DynamicIsland" instead of
// "electron.app.Electron") and groups the settings window in the taskbar.
app.setAppUserModelId('DynamicIsland');

// Let the timer chime play even if the island hasn't been clicked yet.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(() => {
    settingsStore.load();
    createWindow();
    createTray();
    refreshWeather();
    setInterval(refreshWeather, WEATHER_REFRESH_MS);
    setInterval(checkIdleAmbient, 5000);
    powerMonitor.on('lock-screen', () => { screenLocked = true; closeAmbient(); });
    powerMonitor.on('unlock-screen', () => { screenLocked = false; });
    // Ctrl+Alt+M toggles the Now Playing screen. Fails quietly if another app owns it.
    globalShortcut.register('Control+Alt+M', () => (ambientWin ? closeAmbient() : openAmbient()));
    media = startHelper('media.ps1', {
      onMessage: relay,
      onExit: () => relay({ type: 'state', active: false }),
    });
    system = startHelper('system.ps1', { onMessage: relay });
    setInterval(checkHover, 30);
    screen.on('display-added', positionWindow);
    screen.on('display-removed', positionWindow);
    screen.on('display-metrics-changed', positionWindow);
  });

  app.on('window-all-closed', () => app.quit());
  // A second launch (e.g. from a shortcut) opens Settings instead of a second island.
  app.on('second-instance', () => openSettings());
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    if (media) media.stop();
    if (system) system.stop();
  });
}
