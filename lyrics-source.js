// Looks up song lyrics on LRCLIB (https://lrclib.net), a free, open lyrics
// database with time-synced lyrics. Only called while the lyrics panel is open.
const API = 'https://lrclib.net/api';
const HEADERS = { 'User-Agent': 'dynamic-island (personal project)' };

const cache = new Map(); // "title|artist|album" -> result

async function getJson(url) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(8000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`LRCLIB ${res.status}`);
  return res.json();
}

// Strips the noise browsers and video titles add: "(Official Video)",
// "[Lyrics]", "feat. X", "- Remastered 2011" ...
function cleanTitle(title) {
  return title
    .replace(/\s*[([][^)\]]*[)\]]/g, '')
    .replace(/\s+(feat\.?|ft\.?)\s.*$/i, '')
    .replace(/\s+-\s+.*(remaster|version|edit|mix).*$/i, '')
    .trim();
}

// Closest match by duration, preferring entries with synced lyrics.
// Search results whose length is way off are a different song (e.g. a
// 47-minute episode titled "Netflix" matching a 3-minute track).
const MAX_DURATION_GAP_SEC = 15;

function pickBest(results, durationSec) {
  const usable = (results || []).filter((r) => (r.syncedLyrics || r.plainLyrics) &&
    (!durationSec || Math.abs((r.duration || 0) - durationSec) <= MAX_DURATION_GAP_SEC));
  if (!usable.length) return null;
  const score = (r) =>
    (r.syncedLyrics ? 0 : 1000) + (durationSec ? Math.abs((r.duration || 0) - durationSec) : 0);
  return usable.sort((a, b) => score(a) - score(b))[0];
}

async function lookup({ title, artist, album, durationMs }) {
  const durationSec = durationMs > 0 ? Math.round(durationMs / 1000) : 0;
  const q = (params) => new URLSearchParams(params).toString();
  const cleaned = cleanTitle(title) || title;

  // Tried in order. If one fails (LRCLIB sometimes answers 503), try the next;
  // only report an error if every attempt failed.
  const steps = [
    // 1. Exact match (needs all four fields).
    artist && album && durationSec && (async () => {
      const exact = await getJson(`${API}/get?${q({ track_name: title, artist_name: artist, album_name: album, duration: durationSec })}`);
      return exact && (exact.syncedLyrics || exact.plainLyrics) ? exact : null;
    }),
    // 2. Search by title + artist.
    artist && (async () => pickBest(await getJson(`${API}/search?${q({ track_name: cleaned, artist_name: artist })}`), durationSec)),
    // 3. Free-text search, for video titles like "Artist - Song (Official Video)".
    async () => pickBest(await getJson(`${API}/search?${q({ q: cleaned })}`), durationSec),
  ].filter(Boolean);

  let lastError = null;
  let anyAnswered = false;
  for (const step of steps) {
    try {
      const found = await step();
      anyAnswered = true;
      if (found) return found;
    } catch (err) {
      lastError = err;
    }
  }
  if (!anyAnswered) throw lastError;
  return null;
}

// Returns { synced, plain, instrumental } or { none: true }. Throws if LRCLIB couldn't be reached at all
// (not cached, so the next try asks again).
async function getLyrics(track) {
  const key = [track.title, track.artist, track.album].join('|');
  if (cache.has(key)) return cache.get(key);
  const found = await lookup(track);
  const result = found
    ? { synced: found.syncedLyrics || null, plain: found.plainLyrics || null, instrumental: !!found.instrumental }
    : { none: true };
  cache.set(key, result);
  return result;
}

module.exports = { getLyrics };
