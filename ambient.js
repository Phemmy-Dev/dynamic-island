// Full-screen Now Playing screen. Gets the same helper messages as the island
// (via preload.js) and uses widgets/lrc.js for lyrics.
const $ = (id) => document.getElementById(id);
const LEAD_MS = 250;  // same lead as the island's lyrics panel

let np = { active: false };
let lyricLines = null;      // [{ t, el }]
let lyricsKey = null;
let currentLine = -1;
let offsetMs = 0;

function applySettings(s) {
  offsetMs = s.lyricsOffsetMs || 0;
  document.body.classList.toggle('bg-art', s.ambientBg === 'art');
}
window.island.getSettings().then(applySettings);
window.island.onSettings(applySettings);

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

// While dragging the progress bar, everything follows the drag position.
let scrubMs = null;
// After a seek, players keep reporting the old position for a moment.
let lastSeek = { at: 0, ms: 0 };

function position() {
  if (scrubMs !== null) return scrubMs;
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
  document.querySelector('.progress').classList.toggle('seekable', ok && !!np.canSeek);
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

// A bright, blurred copy of the cover for the glass clock digits.
function setGlassArt(src) {
  if (!src) return document.documentElement.style.removeProperty('--glass-art');
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = c.height = 160;
    const ctx = c.getContext('2d');
    ctx.filter = 'blur(20px) brightness(1.6) saturate(1.4)';
    ctx.drawImage(img, -20, -20, 200, 200);  // overdraw so the blur has no dark edges
    document.documentElement.style.setProperty('--glass-art', `url(${c.toDataURL()})`);
  };
  img.src = src;
}

window.island.onHelperMessage((msg) => {
  if (msg.type === 'artwork') {
    setGlassArt(msg.data);
    if (msg.data) $('bg').src = msg.data;
    else $('bg').removeAttribute('src');
    flipImage($('art'), msg.data);
  } else if (msg.type === 'state') {
    if (Date.now() - lastSeek.at < 2000 && msg.title === np.title) {
      msg.positionMs = lastSeek.ms + (msg.status === 'Playing' ? Date.now() - lastSeek.at : 0);
      msg.updatedAtMs = Date.now();
    }
    np = msg;
    render();
  }
});

// Click or drag along the progress bar to jump around the song.
const track = document.querySelector('.progress .track');

function scrubAt(e) {
  const r = track.getBoundingClientRect();
  scrubMs = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * np.durationMs;
  renderProgress();
}

function endScrub() {
  if (scrubMs === null) return;
  const ms = scrubMs;
  scrubMs = null;
  track.classList.remove('scrubbing');
  window.media.seek(ms);
  lastSeek = { at: Date.now(), ms };
  np.positionMs = ms;
  np.updatedAtMs = Date.now();
  renderProgress();
  currentLine = -1;  // re-centre lyrics on the new spot
}

track.addEventListener('pointerdown', (e) => {
  if (!np.canSeek || !(np.durationMs > 0)) return;
  track.setPointerCapture(e.pointerId);
  track.classList.add('scrubbing');
  scrubAt(e);
});
track.addEventListener('pointermove', (e) => { if (scrubMs !== null) scrubAt(e); });
track.addEventListener('pointerup', endScrub);
track.addEventListener('lostpointercapture', endScrub);

$('prev').addEventListener('click', () => window.media.send('prev'));
$('next').addEventListener('click', () => window.media.send('next'));
$('toggle').addEventListener('click', () => window.media.send('toggle'));

// ---------- Lyrics ----------

async function loadLyrics(key) {
  lyricsKey = key;
  lyricLines = null;
  currentLine = -1;
  $('lines').replaceChildren();
  // Keep the lyrics column (empty) while looking up the new song, so the
  // album art doesn't jump to the centre and back. It's hidden below only if
  // the new song turns out to have none.
  const result = await window.media.getLyrics({
    title: np.title, artist: np.artist || '', album: np.album || '', durationMs: np.durationMs || 0,
  });
  if (key !== lyricsKey) return;  // song changed while we waited
  if (result.error) {
    document.body.classList.add('no-lyrics');
    // Lyrics service unreachable: ask again in 15 seconds.
    setTimeout(() => { if (lyricsKey === key) lyricsKey = null; render(); }, 15000);
    return;
  }
  const addLine = (text) => {
    const el = document.createElement('div');
    el.className = 'line';
    el.textContent = text;  // from the internet: never innerHTML
    $('lines').appendChild(el);
    return el;
  };
  document.body.classList.toggle('plain-lyrics', !result.synced);
  if (result.synced) {
    lyricLines = parseLrc(result.synced).map((l) => ({ t: l.t, el: addLine(l.text) }));
  } else if (result.plain) {
    // No timings: show the words as scrollable text.
    $('lines').style.transform = '';
    $('lyrics').scrollTop = 0;
    result.plain.split('\n').forEach((l) => addLine(l.trim() || ' '));
  } else {
    document.body.classList.add('no-lyrics');
    return;
  }
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
  if (!e.target.closest('.card, .corner')) window.island.closeAmbient();
});
$('close').addEventListener('click', () => window.island.closeAmbient());

// Lyrics on/off, remembered.
let lyricsOff = false;
try { lyricsOff = localStorage.getItem('ambientLyricsOff') === '1'; } catch {}
document.body.classList.toggle('lyrics-off', lyricsOff);
$('lyrics-toggle').addEventListener('click', () => {
  lyricsOff = !lyricsOff;
  document.body.classList.toggle('lyrics-off', lyricsOff);
  try { localStorage.setItem('ambientLyricsOff', lyricsOff ? '1' : '0'); } catch {}
  currentLine = -1;  // re-centre the current line when lyrics come back
});
// Typing closes it (you're getting back to work). Space plays/pauses like most
// players; arrows, modifiers, media and volume keys don't count as typing.
const KEEP_OPEN = /^(Arrow|Media|Audio|Volume|Shift|Control|Alt|Meta|CapsLock|Fn)/;
document.addEventListener('keydown', (e) => {
  if (e.key === ' ') {
    e.preventDefault();
    window.media.send('toggle');
  } else if (e.key === 'Escape' || !(e.ctrlKey || e.altKey || e.metaKey || KEEP_OPEN.test(e.key))) {
    window.island.closeAmbient();
  }
});
setTimeout(() => $('hint').classList.add('gone'), 4000);
