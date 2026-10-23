// Settings window. Every change is sent to the main process immediately;
// main validates, saves, and pushes the result back (and to the island).
const $ = (id) => document.getElementById(id);
const api = window.settingsApi;

// [title, description, icon colour, icon path (24px line icon)]
const VIEWS = {
  media: ['Now playing', 'Music and lyrics', 'ic-pink', 'M9 18V6l10-2v12M6.5 15.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM16.5 13.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z'],
  overview: ['Overview', 'Clock, battery, volume', 'ic-purple', 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 8v4l3 2'],
  command: ['Command centre', 'Wi-Fi, Bluetooth, brightness', 'ic-blue', 'M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1M15 5v4M9 10v4M17 15v4'],
  calendar: ['Calendar + timer', 'Month view and countdowns', 'ic-orange', 'M5 6h14v13H5zM5 10h14M9 4v4M15 4v4'],
  notes: ['Notes', 'A quick scratchpad', 'ic-cyan', 'M6 4h9l3 3v13H6zM9 11h6M9 15h4'],
};

const SWATCHES = ['#0a84ff', '#30d158', '#ff9f0a', '#ff375f', '#bf5af2', '#64d2ff'];

let current = null;
let weather = null;

// ---------- Segmented buttons ----------

// <div class="seg" data-key="..."> with <button data-value="..."> children.
document.querySelectorAll('.seg').forEach((seg) => {
  seg.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-value]');
    if (btn) api.set({ [seg.dataset.key]: btn.dataset.value });
  });
});

function renderSegments() {
  document.querySelectorAll('.seg').forEach((seg) => {
    seg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.value === current[seg.dataset.key]));
  });
}

// ---------- Accent swatches ----------

SWATCHES.forEach((color) => {
  const b = document.createElement('button');
  b.className = 'swatch';
  b.dataset.color = color;
  b.title = color;
  b.style.setProperty('--c', color);
  b.addEventListener('click', () => api.set({ accent: 'fixed', accentColor: color }));
  $('swatches').insertBefore(b, $('accent-color'));
});

$('accent-color').addEventListener('input', (e) => api.set({ accent: 'fixed', accentColor: e.target.value }));

// ---------- Live preview ----------

function renderPreview() {
  const mini = $('mini');
  mini.style.setProperty('--bg', `rgba(0, 0, 0, ${current.opacity})`);
  mini.style.setProperty('--accent', current.accent === 'fixed' ? current.accentColor : 'linear-gradient(#ff7ab6, #8f7bff)');
  $('pv-time').textContent = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date());
  const left = $('pv-left');
  const label = document.createElement('span');
  const icon = document.createElement('span');
  if (current.leftWing === 'weather') {
    icon.className = 'mini-cloud';
    label.textContent = `${weather && weather.status === 'ok' ? weather.temp : 24}°`;
  } else if (current.leftWing === 'date') {
    label.textContent = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric' }).format(new Date());
  } else {
    icon.className = 'mini-bat';
    label.textContent = '80%';
  }
  left.replaceChildren(...(icon.className ? [icon] : []), label);
}

setInterval(() => current && renderPreview(), 15000);

// ---------- Views ----------

function renderViews() {
  const list = $('views');
  list.replaceChildren();
  current.views.forEach((view, i) => {
    const [title, sub, color, path] = VIEWS[view.id] || [view.id, '', 'ic-grey', ''];
    const li = document.createElement('li');

    const icon = document.createElement('span');
    icon.className = `ic small ${color}`;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', path);
    svg.appendChild(p);
    icon.appendChild(svg);
    const text = document.createElement('div');
    text.className = 'name';
    const t = document.createElement('div');
    t.textContent = title;
    const s = document.createElement('div');
    s.className = 'hint';
    s.textContent = sub;
    text.append(t, s);

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'switch';
    box.title = 'Show this view';
    box.checked = view.on;
    box.addEventListener('change', () => {
      const views = current.views.map((v) => ({ ...v }));
      views[i].on = box.checked;
      api.set({ views });
    });

    const move = (delta, label, title) => {
      const b = document.createElement('button');
      b.className = 'move';
      b.textContent = label;
      b.title = title;
      b.disabled = i + delta < 0 || i + delta >= current.views.length;
      b.addEventListener('click', () => {
        const views = current.views.map((v) => ({ ...v }));
        [views[i], views[i + delta]] = [views[i + delta], views[i]];
        api.set({ views });
      });
      return b;
    };

    li.classList.toggle('off', !view.on);
    li.append(icon, text, move(-1, '↑', 'Move up'), move(1, '↓', 'Move down'), box);
    list.appendChild(li);
  });
}

// ---------- Auto-hide apps (chips) ----------

function renderChips() {
  const wrap = $('chips');
  wrap.replaceChildren();
  current.tuckApps.forEach((app) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = app;
    const x = document.createElement('button');
    x.textContent = '×';
    x.title = `Remove ${app}`;
    x.addEventListener('click', () => api.set({ tuckApps: current.tuckApps.filter((a) => a !== app) }));
    chip.appendChild(x);
    wrap.appendChild(chip);
  });
  $('apps-row').classList.toggle('disabled', current.tuckMode !== 'browsers');
}

$('add-app').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !e.target.value.trim()) return;
  api.set({ tuckApps: [...current.tuckApps, e.target.value.trim()] });
  e.target.value = '';
});

// ---------- Render ----------

function formatOffset(ms) {
  if (ms === 0) return '0 s';
  return `${ms > 0 ? '+' : '−'}${(Math.abs(ms) / 1000).toFixed(2)} s`;
}

// Fill the form from settings. Fields being edited are left alone so typing
// isn't interrupted by the echo from main.
function render(s) {
  current = s;
  const focused = document.activeElement;
  const setIfIdle = (el, value) => { if (el !== focused) el.value = value; };

  setIfIdle($('opacity'), Math.round(s.opacity * 100));
  $('opacity-value').textContent = `${Math.round(s.opacity * 100)}%`;
  setIfIdle($('accent-color'), s.accentColor);
  document.querySelectorAll('.swatch').forEach((b) => b.classList.toggle('active', s.accent === 'fixed' && b.dataset.color === s.accentColor));
  $('swatches').classList.toggle('dim', s.accent !== 'fixed');
  renderSegments();
  renderViews();
  renderChips();
  setIfIdle($('lyrics-offset'), s.lyricsOffsetMs);
  $('lyrics-offset-value').textContent = formatOffset(s.lyricsOffsetMs);
  setIfIdle($('weather-city'), s.weatherCity);
  $('ambient').checked = s.ambient;
  renderPreview();
}

const WEATHER_LABELS = [[0, 'Clear'], [1, 'Mostly clear'], [2, 'Partly cloudy'], [3, 'Cloudy'], [48, 'Fog'],
  [57, 'Drizzle'], [67, 'Rain'], [77, 'Snow'], [82, 'Showers'], [86, 'Snow showers'], [99, 'Thunderstorm']];

function renderWeather(w) {
  weather = w;
  const el = $('weather-status');
  const ok = w && w.status === 'ok';
  $('weather-card').classList.toggle('show', !!ok);
  if (!w || w.status === 'off') el.textContent = 'Weather is off.';
  else if (w.status === 'loading') el.textContent = 'Looking up the weather…';
  else if (w.status === 'not-found') el.textContent = `Couldn't find "${w.city}". Try adding the country, e.g. "Ikeja, Nigeria".`;
  else if (w.status === 'error') el.textContent = "Couldn't reach the weather service. It'll retry in 15 minutes.";
  else el.textContent = '';
  if (ok) {
    $('wc-place').textContent = w.place;
    $('wc-label').textContent = (WEATHER_LABELS.find(([max]) => w.code <= max) || [0, ''])[1];
    $('wc-temp').textContent = `${w.temp}°`;
    $('wc-range').textContent = `H ${w.high}°  L ${w.low}°`;
  }
  if (current) renderPreview();
}

// ---------- Inputs -> settings ----------

$('opacity').addEventListener('input', (e) => api.set({ opacity: +e.target.value / 100 }));
$('lyrics-offset').addEventListener('input', (e) => api.set({ lyricsOffsetMs: +e.target.value }));
// City is saved when you leave the field or press Enter, not on every key.
$('weather-city').addEventListener('change', (e) => api.set({ weatherCity: e.target.value }));
$('weather-city').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
$('startup').addEventListener('change', (e) => api.setStartWithWindows(e.target.checked));
$('ambient').addEventListener('change', (e) => api.set({ ambient: e.target.checked }));

// Sidebar: show one section at a time.
document.querySelectorAll('.nav').forEach((btn) => btn.addEventListener('click', () => {
  document.querySelectorAll('.nav, .pane').forEach((el) => {
    el.classList.toggle('active', el.dataset.section === btn.dataset.section);
  });
}));

api.onChanged(render);
api.onWeather(renderWeather);
// Also changes when toggled from the tray menu.
api.onStartup((on) => { $('startup').checked = on; });

api.get().then((s) => {
  $('startup').checked = s.startWithWindows;
  weather = s.weather;
  render(s);
  renderWeather(s.weather);
});
