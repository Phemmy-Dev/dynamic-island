// Lyrics panel beside the now-playing card. Synced lyrics follow the song;
// unsynced ones show as scrollable text. Uses globals from renderer.js
// ($, pill, nowPlaying, hasMedia, currentPosition, currentView, isExpanded, seekTo)
// and widgets/lrc.js (parseLrc, lrcIndexAt).
(() => {
  const panel = $('lyrics');
  const list = $('lyrics-lines');
  const status = $('lyrics-status');
  const button = $('btn-lyrics');

  // Highlight a line slightly before its timestamp; the eye needs a moment.
  const LEAD_MS = 250;

  let open = false;
  try { open = localStorage.getItem('lyricsOpen') === '1'; } catch {}

  let trackKey = null;   // track the panel currently shows
  let lines = null;      // [{ t: ms, el }] for synced lyrics
  let current = -1;
  let requestId = 0;
  let retryAfter = 0;    // after a network error, wait before asking again

  const keyOf = (t) => [t.title, t.artist, t.album].join('|');

  function showStatus(text) {
    status.textContent = text;
  }

  function clear() {
    list.replaceChildren();
    list.style.transform = '';
    panel.classList.remove('plain');
    panel.scrollTop = 0;
    lines = null;
    current = -1;
  }

  // timeMs is set for synced lines: clicking one jumps the song there.
  function addLine(text, timeMs) {
    const el = document.createElement('div');
    el.className = 'lyrics-line';
    el.textContent = text;  // lyrics come from the internet: never innerHTML
    if (timeMs !== undefined) {
      el.addEventListener('click', (e) => {
        e.stopPropagation();  // don't pin/unpin the island
        seekTo(timeMs);
        sync(true);
      });
    }
    list.appendChild(el);
    return el;
  }

  async function load() {
    if (!hasMedia()) return;
    const track = { ...nowPlaying };
    trackKey = keyOf(track);
    clear();
    showStatus('Loading lyrics…');

    const id = ++requestId;
    const result = await window.media.getLyrics({
      title: track.title,
      artist: track.artist || '',
      album: track.album || '',
      durationMs: track.durationMs || 0,
    });
    if (id !== requestId) return; // the song changed while we were waiting

    if (result.error) {
      showStatus("Couldn't reach the lyrics service");
      trackKey = null;
      retryAfter = Date.now() + 15000;
    } else if (result.synced) {
      showStatus('');
      lines = parseLrc(result.synced).map((l) => ({ t: l.t, el: addLine(l.text, l.t) }));
      sync(true);
    } else if (result.plain) {
      showStatus('');
      panel.classList.add('plain');
      result.plain.split('\n').forEach((l) => addLine(l.trim() || ' '));
    } else {
      showStatus(result.instrumental ? 'Instrumental' : 'No lyrics found for this song');
    }
  }

  // Centre the current line in the panel.
  function sync(force) {
    if (!lines || !lines.length) return;
    // settings.lyricsOffsetMs: user's timing correction from Settings.
    const index = lrcIndexAt(lines, currentPosition() + LEAD_MS + (settings.lyricsOffsetMs || 0));
    if (index === current && !force) return;
    if (current >= 0 && lines[current]) lines[current].el.classList.remove('current');
    current = index;
    const el = lines[Math.max(0, index)].el;
    if (index >= 0) el.classList.add('current');
    const offset = el.offsetTop + el.offsetHeight / 2;
    list.style.transform = `translateY(${panel.clientHeight / 2 - offset}px)`;
  }

  function setOpen(value) {
    open = value;
    try { localStorage.setItem('lyricsOpen', open ? '1' : '0'); } catch {}
    pill.classList.toggle('lyrics-open', open);
    button.classList.toggle('active', open);
    // Only look lyrics up while the panel is open.
    if (open && hasMedia() && keyOf(nowPlaying) !== trackKey) load();
    else if (open) sync(true);
  }

  button.addEventListener('click', () => {
    holdFootprint();  // closing lyrics shrinks the island; don't let it slip out from under the cursor
    setOpen(!open);
  });

  setInterval(() => {
    if (!open || !hasMedia()) return;
    if (keyOf(nowPlaying) !== trackKey) {
      if (Date.now() >= retryAfter) load();
      return;
    }
    if (isExpanded() && currentView === 'media') sync(false);
  }, 200);

  setOpen(open);
})();
