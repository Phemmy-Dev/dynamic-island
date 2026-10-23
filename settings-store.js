// User settings, kept as JSON in Electron's userData folder. Every value is
// validated here, so the island and the settings window can trust them.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const VIEW_IDS = ['media', 'overview', 'command', 'calendar', 'notes'];
// Apps with tabs or controls in the top middle of the screen.
const TUCK_APPS = ['brave', 'chrome', 'msedge', 'firefox', 'opera', 'vivaldi', 'arc', 'code', 'antigravity ide', 'taskmgr'];

const DEFAULTS = {
  opacity: 1,                       // island background, 0.4 .. 1
  accent: 'album',                  // 'album' (from artwork) | 'fixed'
  accentColor: '#9ae6b4',
  leftWing: 'battery',              // collapsed left wing: 'battery' | 'weather' | 'date'
  views: VIEW_IDS.map((id) => ({ id, on: true })),
  tuckMode: 'browsers',             // 'browsers' | 'always' | 'never'
  tuckApps: TUCK_APPS,
  lyricsOffsetMs: 0,                // -2000 .. 2000; positive shows lines earlier
  weatherCity: '',
  weatherUnits: 'celsius',          // 'celsius' | 'fahrenheit'
  ambient: true,                    // Now Playing screen (idle, button, Ctrl+Alt+M)
};

// Each validator returns the cleaned value, or undefined to reject it.
const VALIDATORS = {
  opacity: (v) => (Number.isFinite(v) ? Math.min(1, Math.max(0.4, v)) : undefined),
  accent: (v) => (['album', 'fixed'].includes(v) ? v : undefined),
  accentColor: (v) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : undefined),
  leftWing: (v) => (['battery', 'weather', 'date'].includes(v) ? v : undefined),
  views: (v) => {
    if (!Array.isArray(v)) return undefined;
    const seen = new Set();
    const out = [];
    for (const item of v) {
      if (item && VIEW_IDS.includes(item.id) && !seen.has(item.id)) {
        seen.add(item.id);
        out.push({ id: item.id, on: !!item.on });
      }
    }
    // Keep every view in the list (append any missing), and at least one on.
    for (const id of VIEW_IDS) if (!seen.has(id)) out.push({ id, on: true });
    if (!out.some((x) => x.on && x.id !== 'media')) out.find((x) => x.id === 'overview').on = true;
    return out;
  },
  tuckMode: (v) => (['browsers', 'always', 'never'].includes(v) ? v : undefined),
  tuckApps: (v) => {
    if (!Array.isArray(v)) return undefined;
    const names = v
      .map((s) => String(s).trim().toLowerCase().replace(/\.exe$/, ''))
      .filter((s) => /^[\w .-]{1,60}$/.test(s));
    return [...new Set(names)].slice(0, 50);
  },
  lyricsOffsetMs: (v) => (Number.isFinite(v) ? Math.round(Math.min(2000, Math.max(-2000, v)) / 50) * 50 : undefined),
  weatherCity: (v) => (typeof v === 'string' ? v.trim().slice(0, 80) : undefined),
  weatherUnits: (v) => (['celsius', 'fahrenheit'].includes(v) ? v : undefined),
  ambient: (v) => (typeof v === 'boolean' ? v : undefined),
};

const file = () => path.join(app.getPath('userData'), 'settings.json');

let settings = { ...DEFAULTS };
const listeners = [];

function clean(partial) {
  const out = {};
  for (const [key, value] of Object.entries(partial || {})) {
    if (!Object.hasOwn(VALIDATORS, key)) continue;
    const v = VALIDATORS[key](value);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

function load() {
  try {
    settings = { ...DEFAULTS, ...clean(JSON.parse(fs.readFileSync(file(), 'utf8'))) };
  } catch {
    settings = { ...DEFAULTS };  // missing or unreadable: start from defaults
  }
  return settings;
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(file()), { recursive: true });
      fs.writeFileSync(file(), JSON.stringify(settings, null, 2));
    } catch (err) {
      console.error('[settings] could not save:', err.message);
    }
  }, 300);
}

// Merges a partial update; returns the full settings.
function update(partial) {
  const changes = clean(partial);
  if (!Object.keys(changes).length) return settings;
  const previous = settings;
  settings = { ...settings, ...changes };
  save();
  for (const fn of listeners) fn(settings, previous);
  return settings;
}

module.exports = {
  load,
  update,
  get: () => settings,
  onChange: (fn) => listeners.push(fn),
};
