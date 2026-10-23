// Settings window. Every change is sent to the main process immediately;
// main validates, saves, and pushes the result back (and to the island).
const $ = (id) => document.getElementById(id);
const api = window.settingsApi;

const VIEW_NAMES = {
  media: 'Now playing',
  overview: 'Overview (clock, battery, volume)',
  command: 'Command centre',
  calendar: 'Calendar + timer',
  notes: 'Notes',
};

let current = null;

function renderViews() {
  const list = $('views');
  list.replaceChildren();
  current.views.forEach((view, i) => {
    const li = document.createElement('li');

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = VIEW_NAMES[view.id] || view.id;
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

    const move = (delta, text, title) => {
      const b = document.createElement('button');
      b.textContent = text;
      b.title = title;
      b.disabled = i + delta < 0 || i + delta >= current.views.length;
      b.addEventListener('click', () => {
        const views = current.views.map((v) => ({ ...v }));
        [views[i], views[i + delta]] = [views[i + delta], views[i]];
        api.set({ views });
      });
      return b;
    };

    li.append(name, move(-1, '↑', 'Move up'), move(1, '↓', 'Move down'), box);
    list.appendChild(li);
  });
}

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
  document.querySelectorAll('input[name="accent"]').forEach((r) => { r.checked = r.value === s.accent; });
  setIfIdle($('accent-color'), s.accentColor);
  $('accent-color').disabled = s.accent !== 'fixed';
  setIfIdle($('left-wing'), s.leftWing);
  renderViews();
  setIfIdle($('tuck-mode'), s.tuckMode);
  setIfIdle($('tuck-apps'), s.tuckApps.join('\n'));
  $('tuck-apps').disabled = s.tuckMode !== 'browsers';
  setIfIdle($('lyrics-offset'), s.lyricsOffsetMs);
  $('lyrics-offset-value').textContent = formatOffset(s.lyricsOffsetMs);
  setIfIdle($('weather-city'), s.weatherCity);
  setIfIdle($('weather-units'), s.weatherUnits);
  $('ambient').checked = s.ambient;
}

function renderWeather(w) {
  const el = $('weather-status');
  if (!w || w.status === 'off') el.textContent = 'Weather is off.';
  else if (w.status === 'loading') el.textContent = 'Looking up the weather…';
  else if (w.status === 'not-found') el.textContent = `Couldn't find "${w.city}". Try adding the country, e.g. "Ikeja, Nigeria".`;
  else if (w.status === 'error') el.textContent = "Couldn't reach the weather service. It'll retry in 15 minutes.";
  else el.textContent = `${w.place}: ${w.temp}${w.unit} now, ${w.high}${w.unit} / ${w.low}${w.unit} today.`;
}

// ---------- Inputs -> settings ----------

$('opacity').addEventListener('input', (e) => api.set({ opacity: +e.target.value / 100 }));
document.querySelectorAll('input[name="accent"]').forEach((r) =>
  r.addEventListener('change', () => api.set({ accent: r.value })));
$('accent-color').addEventListener('input', (e) => api.set({ accentColor: e.target.value }));
$('left-wing').addEventListener('change', (e) => api.set({ leftWing: e.target.value }));
$('tuck-mode').addEventListener('change', (e) => api.set({ tuckMode: e.target.value }));
$('tuck-apps').addEventListener('change', (e) =>
  api.set({ tuckApps: e.target.value.split(/[\n,]/).map((x) => x.trim()).filter(Boolean) }));
$('lyrics-offset').addEventListener('input', (e) => api.set({ lyricsOffsetMs: +e.target.value }));
// City is saved when you leave the field or press Enter, not on every key.
$('weather-city').addEventListener('change', (e) => api.set({ weatherCity: e.target.value }));
$('weather-city').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
$('weather-units').addEventListener('change', (e) => api.set({ weatherUnits: e.target.value }));
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
  render(s);
  renderWeather(s.weather);
});
