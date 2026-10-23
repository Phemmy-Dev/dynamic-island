// Full-screen Now Playing screen. Gets the same helper messages as the island
// (via preload.js) and uses widgets/lrc.js for lyrics.
const $ = (id) => document.getElementById(id);
const LEAD_MS = 250;  // same lead as the island's lyrics panel

let np = { active: false };
let lyricLines = null;      // [{ t, el }]
let lyricsKey = null;
let currentLine = -1;
let offsetMs = 0;

window.island.getSettings().then((s) => { offsetMs = s.lyricsOffsetMs || 0; });

// ---------- Clock ----------

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

function tick() {
  const now = new Date();
  // "12:43" rather than "12:43 PM", like a phone lock screen.
  $('clock').textContent = timeFmt.formatToParts(now).filter((p) => p.type !== 'dayPeriod').map((p) => p.value).join('').trim();
  $('date').textContent = dateFmt.format(now);
}
tick();
setInterval(tick, 1000);

// ---------- Music ----------

const hasMedia = () => np.active && !!np.title && np.status !== 'Closed' && np.status !== 'Stopped';

function position() {
  let pos = np.positionMs || 0;
  if (np.status === 'Playing' && np.updatedAtMs) pos += Date.now() - np.updatedAtMs;
  return Math.min(pos, np.durationMs || pos);
}

function fmt(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function renderProgress() {
  const ok = hasMedia() && np.durationMs > 0;
  document.querySelector('.progress').classList.toggle('hidden', !ok);
  if (!ok) return;
  const pos = position();
  $('fill').style.width = `${(pos / np.durationMs) * 100}%`;
  $('elapsed').textContent = fmt(pos);
  $('remaining').textContent = '-' + fmt(np.durationMs - pos);
}

function render() {
  document.body.classList.toggle('no-media', !hasMedia());
  document.body.classList.toggle('playing', hasMedia() && np.status === 'Playing');
  if (!hasMedia()) return;
  $('title').textContent = np.title;
  $('artist').textContent = np.artist || np.album || '';
  renderProgress();
  const key = [np.title, np.artist, np.album].join('|');
  if (key !== lyricsKey) loadLyrics(key);
}

window.island.onHelperMessage((msg) => {
  if (msg.type === 'artwork') {
    if (msg.data) $('bg').src = msg.data;
    else $('bg').removeAttribute('src');
    flipImage($('art'), msg.data);
  } else if (msg.type === 'state') {
    np = msg;
    render();
  }
});

$('prev').addEventListener('click', () => window.media.send('prev'));
$('next').addEventListener('click', () => window.media.send('next'));
$('toggle').addEventListener('click', () => window.media.send('toggle'));

// ---------- Lyrics ----------

async function loadLyrics(key) {
  lyricsKey = key;
  lyricLines = null;
  currentLine = -1;
  $('lines').replaceChildren();
  document.body.classList.add('no-lyrics');
  const result = await window.media.getLyrics({
    title: np.title, artist: np.artist || '', album: np.album || '', durationMs: np.durationMs || 0,
  });
  if (key !== lyricsKey || !result.synced) return;  // song changed, or nothing synced to show
  lyricLines = parseLrc(result.synced).map((l) => {
    const el = document.createElement('div');
    el.className = 'line';
    el.textContent = l.text;  // from the internet: never innerHTML
    $('lines').appendChild(el);
    return { t: l.t, el };
  });
  document.body.classList.remove('no-lyrics');
}

function syncLyrics() {
  if (!lyricLines || !lyricLines.length) return;
  const index = lrcIndexAt(lyricLines, position() + LEAD_MS + offsetMs);
  if (index === currentLine) return;
  if (currentLine >= 0) lyricLines[currentLine].el.classList.remove('current');
  currentLine = index;
  const el = lyricLines[Math.max(0, index)].el;
  if (index >= 0) el.classList.add('current');
  $('lines').style.transform = `translateY(${$('lyrics').clientHeight / 2 - (el.offsetTop + el.offsetHeight / 2)}px)`;
}

setInterval(() => {
  if (np.status === 'Playing') renderProgress();
  syncLyrics();
}, 200);

// ---------- Closing ----------

// Moving the mouse doesn't close it (you'd never reach the buttons);
// a click outside the music card or Esc does.
document.addEventListener('click', (e) => {
  if (!e.target.closest('.card')) window.island.closeAmbient();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.island.closeAmbient();
});
setTimeout(() => $('hint').classList.add('gone'), 4000);
