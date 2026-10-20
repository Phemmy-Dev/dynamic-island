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
function pickBest(results, durationSec) {
  const usable = (results || []).filter((r) => r.syncedLyrics || r.plainLyrics);
  if (!usable.length) return null;
  const score = (r) =>
    (r.syncedLyrics ? 0 : 1000) + (durationSec ? Math.abs((r.duration || 0) - durationSec) : 0);
  return usable.sort((a, b) => score(a) - score(b))[0];
}

async function lookup({ title, artist, album, durationMs }) {
  const durationSec = durationMs > 0 ? Math.round(durationMs / 1000) : 0;
  const q = (params) => new URLSearchParams(params).toString();

  // 1. Exact match (needs all four fields).
  if (artist && album && durationSec) {
    const exact = await getJson(`${API}/get?${q({
      track_name: title, artist_name: artist, album_name: album, duration: durationSec,
    })}`);
    if (exact && (exact.syncedLyrics || exact.plainLyrics)) return exact;
  }

  // 2. Search by title + artist.
  const cleaned = cleanTitle(title) || title;
  if (artist) {
    const best = pickBest(await getJson(`${API}/search?${q({ track_name: cleaned, artist_name: artist })}`), durationSec);
    if (best) return best;
  }

  // 3. Free-text search, for video titles like "Artist - Song (Official Video)".
  return pickBest(await getJson(`${API}/search?${q({ q: cleaned })}`), durationSec);
}

// Returns { synced, plain, instrumental } or { none: true }. Throws on network errors.
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
