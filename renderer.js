// Note: don't declare top-level variables named `island`, `media` or `system`:
// those are the preload bridges, and redeclaring them throws a SyntaxError.
//
// Widgets in widgets/*.js load after this file and use its globals ($, pill,
// peek, pinned, collapse, ...).

const $ = (id) => document.getElementById(id);
const pill = $('pill');

// User settings (see settings-store.js); filled in from main at startup and
// whenever they change. Until then these defaults apply.
let settings = {
  opacity: 1,
  accent: 'album',
  accentColor: '#9ae6b4',
  leftWing: 'battery',
  views: ['media', 'overview', 'command', 'calendar', 'notes'].map((id) => ({ id, on: true })),
  // Auto-hide: tuck into a thin sliver over these apps ('browsers'), over any
  // app ('always'), or 'never'. Rest the cursor on the top edge to bring it back.
  tuckMode: 'browsers',
  tuckApps: ['brave', 'chrome', 'msedge', 'firefox', 'opera', 'vivaldi', 'arc', 'code', 'antigravity ide', 'taskmgr'],
  lyricsOffsetMs: 0,
};
const TUCK_MODES = { browsers: 'Listed apps', always: 'Any app', never: 'Off' };
let weather = null;

// Latest state from the helpers (see the bottom of this file).
let nowPlaying = { active: false };
let systemState = null;

// ---------- Icons ----------

function volumeIcon(level, muted) {
  const speaker = '<path d="M3 9h4l5-4v14l-5-4H3z" fill="currentColor"/>';
  const wave = (d) => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`;
  let extra = '';
  if (muted || level === 0) {
    extra = wave('M16 9.5l5 5M21 9.5l-5 5');
  } else {
    extra = wave('M15.5 9.5a3.5 3.5 0 0 1 0 5');
    if (level >= 0.5) extra += wave('M18 7a7 7 0 0 1 0 10');
  }
  return `<svg class="icon" viewBox="0 0 24 24">${speaker}${extra}</svg>`;
}

function batteryIcon(percent, charging) {
  const fill = Math.max(1.5, 17 * percent / 100);
  const bolt = charging
    ? '<path d="M12.6 1.8 7.6 7.6h3.4l-1.6 4.6 5-5.8H11z" fill="#fff" stroke="#000" stroke-width="0.9" stroke-linejoin="round"/>'
    : '';
  return `<svg class="icon battery-icon" viewBox="0 0 26 14">
    <rect x="0.75" y="0.75" width="21" height="12.5" rx="3.5" fill="none" stroke="currentColor" stroke-opacity="0.45" stroke-width="1.5"/>
    <rect x="23" y="4.5" width="2" height="5" rx="1" fill="currentColor" fill-opacity="0.45"/>
    <rect x="2.5" y="2.5" width="${fill}" height="9" rx="2" fill="var(--battery-fill)"/>
    ${bolt}</svg>`;
}

// ---------- Clock ----------

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
const shortDateFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const wingDateFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric' });

function tick() {
  const now = new Date();
  const time = timeFmt.format(now);
  $('clock-small').textContent = time;
  $('clock-large').textContent = time;
  $('clock-header').textContent = time;
  $('date').textContent = dateFmt.format(now);
  $('date-header').textContent = shortDateFmt.format(now);
  $('wing-date').textContent = wingDateFmt.format(now);
  // Re-sync to the start of the next minute.
  setTimeout(tick, 60000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 20);
}
tick();

// ---------- Views ----------

const viewEls = {};
document.querySelectorAll('.view').forEach((el) => { viewEls[el.dataset.view] = el; });
let currentView = 'overview';

function availableViews() {
  const views = settings.views
    .filter((v) => v.on && (v.id !== 'media' || hasMedia()))
    .map((v) => v.id);
  return views.length ? views : ['overview'];
}

function defaultView() {
  return availableViews()[0];
}

function setView(name) {
  const views = availableViews();
  if (!views.includes(name)) name = views[0];
  currentView = name;
  pill.dataset.view = name;
  // Views above the active one slide out upwards, the rest downwards.
  const activeIndex = views.indexOf(name);
  for (const [viewName, el] of Object.entries(viewEls)) {
    const index = views.indexOf(viewName);
    el.classList.toggle('active', viewName === name);
    el.classList.toggle('before', index !== -1 && index < activeIndex);
  }
  const dots = $('view-dots');
  dots.innerHTML = views.length > 1
    ? views.map((v) => `<i data-view="${v}" class="${v === name ? 'active' : ''}"></i>`).join('')
    : '';
  if (name === 'media') updateProgress();
}

function stepView(direction) {
  const views = availableViews();
  const index = views.indexOf(currentView);
  setView(views[(index + direction + views.length) % views.length]);
}

setView(currentView);

// Clicking a dot jumps straight to that view.
$('view-dots').addEventListener('click', (e) => {
  const dot = e.target.closest('i[data-view]');
  if (!dot) return;
  e.stopPropagation();  // don't pin/unpin the island
  setView(dot.dataset.view);
});

// ---------- Expand / collapse ----------

// Hover expands temporarily; a click pins it open until you click elsewhere.
let pinned = false;
const isExpanded = () => pill.classList.contains('expanded');

function expand() {
  if (!isExpanded()) setView(defaultView());
  stopPeek();
  pill.classList.add('expanded');
  reportRect();
}

function collapse() {
  pinned = false;
  pill.classList.remove('expanded');
  reportRect();
}

// Main process tracks the cursor against this rect (it changes as the pill animates).
// While tucked, the main process waits for the cursor to rest before reacting,
// so quick clicks fall through to the window underneath.
function reportRect() {
  const r = pill.getBoundingClientRect();
  const tucked = pill.classList.contains('tucked') && !isExpanded();
  window.island.reportPillRect({ x: r.x, y: r.y, width: r.width, height: r.height, tucked });
}
new ResizeObserver(reportRect).observe(pill);
reportRect();

window.island.onHover((inside) => {
  if (inside) expand();
  else if (!pinned) collapse();
});

pill.addEventListener('click', () => {
  if (pinned) {
    collapse();
  } else {
    pinned = true;
    expand();
  }
});

// Clicking any other window blurs ours.
window.island.onBlur(collapse);

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (document.activeElement) document.activeElement.blur();
  collapse();
});

// Scroll switches views (one per gesture), except over a volume or brightness
// row, where it adjusts that level.
let wheelAccum = 0;
let lastWheelAt = 0;
let wheelLockedUntil = 0;

pill.addEventListener('wheel', (e) => {
  // Let a scrollable text box (notes, plain lyrics) scroll itself until it hits an end.
  const box = e.target.closest('textarea, .lyrics.plain');
  if (box && box.scrollHeight > box.clientHeight) {
    const atTop = box.scrollTop <= 0;
    const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 1;
    if ((e.deltaY < 0 && !atTop) || (e.deltaY > 0 && !atBottom)) return;
  }

  e.preventDefault();
  const now = Date.now();

  // Widgets can claim the wheel over an element by giving it the
  // "wheel-target" class and an islandWheel(step) function.
  const target = e.target.closest('.wheel-target');
  if (target && target.islandWheel) {
    target.islandWheel(e.deltaY < 0 ? 1 : -1);
    return;
  }

  const step = e.deltaY < 0 ? 1 : -1;
  if (e.target.closest('.volume-row') && systemState && systemState.volume !== null) {
    setVolume(systemState.volume + step * 0.02);
    return;
  }
  if (e.target.closest('.brightness-row') && systemState && systemState.brightness != null) {
    setBrightness(systemState.brightness + step * 5);
    return;
  }

  if (!isExpanded()) { expand(); return; }
  if (now < wheelLockedUntil) return;
  if (now - lastWheelAt > 300) wheelAccum = 0;
  lastWheelAt = now;
  wheelAccum += e.deltaY;
  // Touchpads send many small deltas; mouse wheels send ~100 per notch.
  if (Math.abs(wheelAccum) < 50) return;
  stepView(Math.sign(wheelAccum));
  wheelAccum = 0;
  wheelLockedUntil = now + 450;
}, { passive: false });

// Don't let button/slider/text clicks pin or unpin the pill.
document.querySelectorAll('button, input, textarea').forEach((el) => {
  el.addEventListener('click', (e) => e.stopPropagation());
});

// ---------- Peek (collapsed notifications) ----------

let peekTimer = null;

function peek(iconHtml, fraction, valueText, durationMs = 1800) {
  if (isExpanded()) return;
  $('peek-icon').innerHTML = iconHtml;
  $('peek-fill').style.width = `${Math.round(fraction * 100)}%`;
  $('peek-value').textContent = valueText;
  pill.classList.add('peeking');
  clearTimeout(peekTimer);
  peekTimer = setTimeout(stopPeek, durationMs);
}

function stopPeek() {
  clearTimeout(peekTimer);
  pill.classList.remove('peeking');
}

// ---------- System: battery + volume ----------

let lastLocalVolumeChange = 0;
let draggingVolume = false;
const volumeSliders = document.querySelectorAll('.volume-slider');

function setVolume(level) {
  level = Math.min(1, Math.max(0, Math.round(level * 100) / 100));
  lastLocalVolumeChange = Date.now();
  window.system.setVolume(level);
  if (systemState) {
    systemState.volume = level;
    if (level > 0) systemState.muted = false;
    renderVolume();
  }
}

function batteryStatusText(b) {
  if (b.charging) return 'Charging';
  if (b.pluggedIn) return 'Plugged in';
  if (b.remainingSec > 0) {
    const h = Math.floor(b.remainingSec / 3600);
    const m = Math.round((b.remainingSec % 3600) / 60);
    return h ? `${h}h ${m}m left` : `${m}m left`;
  }
  return 'On battery';
}

function renderBattery() {
  const b = systemState.battery;
  pill.classList.toggle('has-battery', !!b.present);
  renderLeftWing();
  if (!b.present) return;
  const low = b.percent <= 20 && !b.pluggedIn;
  document.documentElement.style.setProperty('--battery-fill', b.charging ? '#34c759' : low ? '#ff453a' : '#fff');
  const icon = batteryIcon(b.percent, b.charging);
  $('wing-battery-icon').innerHTML = icon;
  $('ov-battery-icon').innerHTML = icon;
  $('wing-battery').textContent = `${b.percent}%`;
  $('ov-battery').textContent = `${b.percent}%`;
  $('ov-battery-status').textContent = batteryStatusText(b);
}

function renderVolume() {
  const { volume, muted } = systemState;
  const hasDevice = volume !== null;
  document.querySelectorAll('.volume-row').forEach((row) => {
    row.style.visibility = hasDevice ? 'visible' : 'hidden';
  });
  if (!hasDevice) return;
  const pct = Math.round(volume * 100);
  const icon = volumeIcon(volume, muted);
  const label = muted ? 'Muted' : `${pct}%`;
  $('wing-volume-icon').innerHTML = icon;
  $('wing-volume').textContent = label;
  document.querySelectorAll('.mute-icon').forEach((el) => { el.innerHTML = icon; });
  document.querySelectorAll('.volume-value').forEach((el) => { el.textContent = label; });
  volumeSliders.forEach((slider) => {
    if (!draggingVolume) slider.value = pct;
    slider.style.setProperty('--fill', `${muted ? 0 : slider.value}%`);
  });
}

function renderTuck() {
  const covered = systemState.coveredBy;
  const tucked = settings.tuckMode === 'always'
    ? !!covered
    : settings.tuckMode === 'browsers' && settings.tuckApps.includes(covered);
  if (tucked === pill.classList.contains('tucked')) return;
  pill.classList.toggle('tucked', tucked);
  reportRect();
}

function onSystemMessage(msg) {
  const prev = systemState;
  systemState = msg;
  renderBattery();
  renderVolume();
  renderTuck();
  renderBrightness();
  renderRadios();
  if (!prev) return;

  // Volume changed from outside the island (keyboard keys, other apps).
  const volumeChanged = prev.volume !== msg.volume || prev.muted !== msg.muted;
  if (volumeChanged && msg.volume !== null && Date.now() - lastLocalVolumeChange > 1000) {
    peek(volumeIcon(msg.volume, msg.muted), msg.muted ? 0 : msg.volume,
      msg.muted ? 'Muted' : `${Math.round(msg.volume * 100)}%`);
  }

  // Charger plugged in or removed.
  if (msg.battery.present && prev.battery.pluggedIn !== msg.battery.pluggedIn) {
    peek(batteryIcon(msg.battery.percent, msg.battery.charging), msg.battery.percent / 100,
      `${msg.battery.percent}%`);
  }
}

volumeSliders.forEach((slider) => {
  slider.addEventListener('pointerdown', () => { draggingVolume = true; });
  slider.addEventListener('input', () => setVolume(slider.value / 100));
});
window.addEventListener('pointerup', () => {
  draggingVolume = false;
  draggingBrightness = false;
});
document.querySelectorAll('.mute-btn').forEach((btn) => btn.addEventListener('click', () => {
  lastLocalVolumeChange = Date.now();
  window.system.toggleMute();
}));

// ---------- Command centre: brightness, radios, auto-hide, shortcuts ----------

let draggingBrightness = false;
let lastLocalBrightnessChange = 0;
const brightnessSlider = $('brightness-slider');

function setBrightness(level) {
  level = Math.min(100, Math.max(0, Math.round(level)));
  lastLocalBrightnessChange = Date.now();
  window.system.setBrightness(level);
  brightnessSlider.value = level;
  if (systemState) {
    systemState.brightness = level;
    renderBrightness();
  }
}

function renderBrightness() {
  const level = systemState.brightness;
  // Only built-in laptop screens report brightness.
  const supported = level !== null && level !== undefined;
  $('brightness-row').style.display = supported ? '' : 'none';
  if (!supported) return;
  // The helper reads brightness once a second, so ignore its echo of an
  // older value right after the slider moved.
  if (!draggingBrightness && Date.now() - lastLocalBrightnessChange > 1500) brightnessSlider.value = level;
  brightnessSlider.style.setProperty('--fill', `${brightnessSlider.value}%`);
  $('brightness-value').textContent = `${brightnessSlider.value}%`;
}

brightnessSlider.addEventListener('pointerdown', () => { draggingBrightness = true; });
brightnessSlider.addEventListener('input', () => setBrightness(+brightnessSlider.value));

// A tile shows the requested state straight away and waits (up to 4s) for
// the helper to confirm it.
const pendingRadios = {};

function radioState(kind) {
  const pending = pendingRadios[kind];
  if (pending && Date.now() < pending.until) return pending.state;
  delete pendingRadios[kind];
  return systemState && systemState.radios ? systemState.radios[kind] : null;
}

function renderRadioTile(kind, onText) {
  const state = radioState(kind);
  const tile = $(`tile-${kind}`);
  tile.disabled = !state || state === 'Disabled';
  tile.classList.toggle('on', state === 'On');
  tile.classList.toggle('pending', !!pendingRadios[kind]);
  $(`tile-${kind}-sub`).textContent =
    !state ? 'Unavailable' : state === 'Disabled' ? 'Airplane mode' : state === 'Off' ? 'Off' : onText;
}

function renderRadios() {
  // Drop a pending state once the helper reports it.
  for (const kind of Object.keys(pendingRadios)) {
    if (systemState.radios && systemState.radios[kind] === pendingRadios[kind].state) delete pendingRadios[kind];
  }
  const net = systemState.network || {};
  renderRadioTile('wifi', net.type === 'wifi' && net.name ? net.name : 'Not connected');
  renderRadioTile('bluetooth', 'On');
}

function toggleRadio(kind) {
  const state = radioState(kind);
  if (state !== 'On' && state !== 'Off') return;
  const next = state === 'On' ? 'Off' : 'On';
  pendingRadios[kind] = { state: next, until: Date.now() + 4000 };
  window.system.setRadio(kind, next === 'On');
  renderRadios();
}

$('tile-wifi').addEventListener('click', () => toggleRadio('wifi'));
$('tile-bluetooth').addEventListener('click', () => toggleRadio('bluetooth'));

function renderTuckTile() {
  $('tile-tuck').classList.toggle('on', settings.tuckMode !== 'never');
  $('tile-tuck-sub').textContent = TUCK_MODES[settings.tuckMode];
}

// Cycles the mode; main saves it and sends the new settings back.
$('tile-tuck').addEventListener('click', () => {
  const modes = Object.keys(TUCK_MODES);
  window.island.setSettings({ tuckMode: modes[(modes.indexOf(settings.tuckMode) + 1) % modes.length] });
});
renderTuckTile();

document.querySelectorAll('[data-shortcut]').forEach((btn) => btn.addEventListener('click', () => {
  // Get out of the way first (e.g. so a screenshot doesn't include the island).
  collapse();
  window.island.shortcut(btn.dataset.shortcut);
}));

// ---------- Media ----------

const artImages = document.querySelectorAll('.art');

const APP_NAMES = {
  'spotify.exe': 'Spotify',
  'msedge': 'Microsoft Edge',
  'msedge.exe': 'Microsoft Edge',
  'chrome': 'Google Chrome',
  'chrome.exe': 'Google Chrome',
  'brave': 'Brave',
  'brave.exe': 'Brave',
  'firefox.exe': 'Firefox',
  'microsoft.zunemusic': 'Media Player',
};

function appName(id) {
  if (!id) return '';
  // Store apps look like "Publisher.App_hash!App"; desktop apps like "Spotify.exe".
  const base = id.split('!').pop();
  return APP_NAMES[base.toLowerCase()] || base.replace(/\.exe$/i, '');
}

function hasMedia() {
  return nowPlaying.active && !!nowPlaying.title &&
    nowPlaying.status !== 'Closed' && nowPlaying.status !== 'Stopped';
}

function formatTime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m % 60).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

// Apps only report position occasionally, so extrapolate while playing.
function currentPosition() {
  let pos = nowPlaying.positionMs || 0;
  if (nowPlaying.status === 'Playing' && nowPlaying.updatedAtMs) pos += Date.now() - nowPlaying.updatedAtMs;
  return Math.min(pos, nowPlaying.durationMs || pos);
}

// Position being dragged to on the progress bar, or null.
let scrubbingMs = null;
// After a seek, players keep reporting the old position for a moment; ignore
// those reports so the bar doesn't jump back.
let lastSeek = { at: 0, ms: 0, key: '' };
const trackKey = (t) => `${t.app}|${t.title}|${t.artist}`;

function seekTo(ms) {
  if (!nowPlaying.canSeek) return;
  ms = Math.max(0, Math.min(nowPlaying.durationMs || ms, ms));
  window.media.seek(ms);
  lastSeek = { at: Date.now(), ms, key: trackKey(nowPlaying) };
  nowPlaying.positionMs = ms;
  nowPlaying.updatedAtMs = Date.now();
  updateProgress();
}

function updateProgress() {
  const hasTimeline = nowPlaying.active && nowPlaying.durationMs > 0;
  $('progress').classList.toggle('hidden', !hasTimeline);
  $('progress').classList.toggle('seekable', hasTimeline && !!nowPlaying.canSeek);
  if (!hasTimeline) return;
  const pos = scrubbingMs ?? currentPosition();
  $('progress-fill').style.width = `${(pos / nowPlaying.durationMs) * 100}%`;
  $('elapsed').textContent = formatTime(pos);
  $('remaining').textContent = '-' + formatTime(nowPlaying.durationMs - pos);
}

setInterval(() => {
  if (isExpanded() && currentView === 'media' && nowPlaying.status === 'Playing') updateProgress();
}, 250);

function renderMedia() {
  const show = hasMedia();
  pill.classList.toggle('has-media', show);
  pill.classList.toggle('playing', show && nowPlaying.status === 'Playing');
  pill.classList.toggle('can-seek', show && !!nowPlaying.canSeek);
  // Keep the view list (and dots) in sync with whether media exists.
  setView(currentView);
  if (!show) return;
  $('track-title').textContent = nowPlaying.title;
  $('track-artist').textContent = nowPlaying.artist || nowPlaying.album || '';
  $('track-app').textContent = appName(nowPlaying.app);
  $('btn-prev').disabled = !nowPlaying.canPrev;
  $('btn-next').disabled = !nowPlaying.canNext;
  $('btn-toggle').disabled = !nowPlaying.canToggle;
  updateProgress();
}

// ---------- Weather ----------

// WMO weather code -> [label, glyph]. Glyphs are line icons on a 24px grid.
function weatherInfo(code, isDay) {
  const sun = '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>';
  const moon = '<path d="M19 14.5A7.5 7.5 0 1 1 9.5 5a6 6 0 0 0 9.5 9.5z"/>';
  const cloud = '<path d="M7 18h10a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7 11a3.5 3.5 0 0 0 0 7z"/>';
  const partly = '<path d="M8 3v1.5M3 8h1.5M4.5 4.5l1 1M12 5.5A3.5 3.5 0 0 0 5.6 9"/><path d="M8.5 19h8a3.5 3.5 0 0 0 .5-6.96A4.8 4.8 0 0 0 8.2 13a3 3 0 0 0 .3 6z"/>';
  const rain = '<path d="M7 14h10a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7 7a3.5 3.5 0 0 0 0 7z"/><path d="M9 17l-1 3M13 17l-1 3M17 17l-1 3"/>';
  const snow = '<path d="M7 14h10a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7 7a3.5 3.5 0 0 0 0 7z"/><path d="M9 18h.01M12 20h.01M15 18h.01"/>';
  const storm = '<path d="M7 14h10a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7 7a3.5 3.5 0 0 0 0 7z"/><path d="M12.5 15l-2 3.5h3l-2 3.5"/>';
  const fog = '<path d="M4 9h16M6 13h12M4 17h16"/>';
  let label, shape;
  if (code <= 1) [label, shape] = [code === 0 ? 'Clear' : 'Mostly clear', isDay ? sun : moon];
  else if (code === 2) [label, shape] = ['Partly cloudy', isDay ? partly : cloud];
  else if (code === 3) [label, shape] = ['Cloudy', cloud];
  else if (code <= 48) [label, shape] = ['Fog', fog];
  else if (code <= 57) [label, shape] = ['Drizzle', rain];
  else if (code <= 67) [label, shape] = ['Rain', rain];
  else if (code <= 77) [label, shape] = ['Snow', snow];
  else if (code <= 82) [label, shape] = ['Showers', rain];
  else if (code <= 86) [label, shape] = ['Snow showers', snow];
  else [label, shape] = ['Thunderstorm', storm];
  return { label, icon: `<svg class="glyph" viewBox="0 0 24 24">${shape}</svg>` };
}

function renderWeather() {
  const ok = weather && weather.status === 'ok';
  const box = $('ov-weather');
  box.replaceChildren();
  if (ok) {
    const { label, icon } = weatherInfo(weather.code, weather.isDay);
    const deg = weather.unit.slice(0, 1);  // "°"
    box.insertAdjacentHTML('beforeend', icon);
    const text = document.createElement('span');
    text.textContent = `${weather.temp}${deg} ${label} · H ${weather.high}${deg} L ${weather.low}${deg}`;
    box.appendChild(text);
    box.title = weather.place;
    $('wing-weather-icon').innerHTML = icon;
    $('wing-weather').textContent = `${weather.temp}${deg}`;
  }
  renderLeftWing();
}

// The collapsed left side shows the chosen item, falling back when it isn't
// available (no battery, or no weather yet).
function renderLeftWing() {
  const hasBattery = !!(systemState && systemState.battery && systemState.battery.present);
  const hasWeather = !!(weather && weather.status === 'ok');
  let show = settings.leftWing;
  if (show === 'weather' && !hasWeather) show = 'battery';
  if (show === 'battery' && !hasBattery) show = 'date';
  for (const k of ['battery', 'weather', 'date']) pill.classList.toggle(`wing-${k}`, k === show);
}

// ---------- Settings ----------

function applySettings(next) {
  settings = next;
  const root = document.documentElement.style;
  root.setProperty('--island-bg', `rgba(0, 0, 0, ${settings.opacity})`);
  applyAccent(lastArtwork);
  renderTuckTile();
  if (systemState) renderTuck();
  renderLeftWing();
  // Keep the current view if it's still enabled, otherwise fall back.
  setView(currentView);
}

window.island.onSettings(applySettings);
window.island.getSettings().then((s) => {
  weather = s.weather;
  applySettings(s);
  renderWeather();
});

// Right-click the island to open Settings.
pill.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.island.openSettings();
});

// Pick the artwork's most vivid colour (a saturation-weighted average, so grey
// and near-black pixels barely count). It becomes --accent (bright: equalizer
// bars) and --art-tint (dark: the island's background while lyrics show).
let lastArtwork = null;

function applyAccent(src) {
  const root = document.documentElement.style;
  // A fixed accent (from Settings) replaces the album-art colour.
  if (settings.accent === 'fixed') {
    const hex = settings.accentColor;
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const dark = 120 / Math.max(r, g, b, 1);
    root.setProperty('--accent', hex);
    root.setProperty('--art-tint', `rgb(${[r, g, b].map((v) => Math.round(Math.min(255, v * dark))).join(', ')})`);
    return;
  }
  if (!src) {
    root.removeProperty('--accent');
    root.removeProperty('--art-tint');
    return;
  }
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = c.height = 24;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, 24, 24);
    const d = ctx.getImageData(0, 0, 24, 24).data;
    let r = 0, g = 0, b = 0, total = 0;
    for (let i = 0; i < d.length; i += 4) {
      const max = Math.max(d[i], d[i + 1], d[i + 2]);
      const min = Math.min(d[i], d[i + 1], d[i + 2]);
      const sat = max ? (max - min) / max : 0;
      const w = 0.03 + sat * sat * (max / 255);
      r += d[i] * w; g += d[i + 1] * w; b += d[i + 2] * w; total += w;
    }
    [r, g, b] = [r / total, g / total, b / total];
    const shade = (target) => {
      const scale = target / Math.max(r, g, b, 1);
      return `rgb(${[r, g, b].map((v) => Math.round(Math.min(255, v * scale))).join(', ')})`;
    };
    root.setProperty('--accent', shade(220));
    root.setProperty('--art-tint', shade(120));
  };
  img.src = src;
}

function onArtwork(data) {
  lastArtwork = data;
  artImages.forEach((img) => {
    if (data) img.src = data;
    else img.removeAttribute('src');
  });
  applyAccent(data);
}

$('btn-prev').addEventListener('click', () => window.media.send('prev'));
$('btn-next').addEventListener('click', () => window.media.send('next'));
$('btn-toggle').addEventListener('click', () => {
  window.media.send('toggle');
  // Flip the icon immediately; the next helper update confirms it.
  if (nowPlaying.status === 'Playing' || nowPlaying.status === 'Paused') {
    nowPlaying.positionMs = currentPosition();
    nowPlaying.updatedAtMs = Date.now();
    nowPlaying.status = nowPlaying.status === 'Playing' ? 'Paused' : 'Playing';
    renderMedia();
  }
});

// ---------- Helper messages ----------

window.island.onHelperMessage((msg) => {
  if (msg.type === 'system') onSystemMessage(msg);
  else if (msg.type === 'weather') {
    weather = msg;
    renderWeather();
  }
  else if (msg.type === 'artwork') onArtwork(msg.data);
  else if (msg.type === 'state') {
    if (Date.now() - lastSeek.at < 2000 && trackKey(msg) === lastSeek.key) {
      msg.positionMs = lastSeek.ms + (msg.status === 'Playing' ? Date.now() - lastSeek.at : 0);
      msg.updatedAtMs = Date.now();
    }
    nowPlaying = msg;
    renderMedia();
  }
});

// Click or drag along the progress bar to move around in the song.
const progressTrack = document.querySelector('.progress-track');

function scrubAt(e) {
  const r = progressTrack.getBoundingClientRect();
  const fraction = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  scrubbingMs = fraction * nowPlaying.durationMs;
  updateProgress();
}

function endScrub() {
  if (scrubbingMs === null) return;
  const target = scrubbingMs;
  scrubbingMs = null;
  progressTrack.classList.remove('scrubbing');
  seekTo(target);
}

progressTrack.addEventListener('pointerdown', (e) => {
  if (!nowPlaying.canSeek || !(nowPlaying.durationMs > 0)) return;
  e.preventDefault();
  progressTrack.setPointerCapture(e.pointerId);
  progressTrack.classList.add('scrubbing');
  scrubAt(e);
});
progressTrack.addEventListener('pointermove', (e) => { if (scrubbingMs !== null) scrubAt(e); });
progressTrack.addEventListener('pointerup', endScrub);
// If the cursor leaves the island mid-drag, the window stops getting mouse
// events; seek to wherever the drag got to.
progressTrack.addEventListener('lostpointercapture', endScrub);
progressTrack.addEventListener('click', (e) => e.stopPropagation());

