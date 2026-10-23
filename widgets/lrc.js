// Synced-lyrics parser, shared by the island's lyrics panel and the Now Playing screen.
// "[01:02.34] text" -> { t: 62340, text }. A line may carry several stamps.
function parseLrc(lrc) {
  const out = [];
  for (const raw of lrc.split('\n')) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!stamps.length) continue;
    const text = raw.replace(/\[[^\]]*\]/g, '').trim() || '♪';
    for (const m of stamps) out.push({ t: (+m[1] * 60 + +m[2]) * 1000, text });
  }
  return out.sort((a, b) => a.t - b.t);
}

// Index of the line showing at positionMs (-1 before the first line).
function lrcIndexAt(lines, positionMs) {
  let index = -1;
  for (let i = 0; i < lines.length && lines[i].t <= positionMs; i++) index = i;
  return index;
}

console.assert(parseLrc('[00:01.50] a\n[00:00.50][00:03.00] b').map((l) => l.t).join() === '500,1500,3000', 'parseLrc');
console.assert(lrcIndexAt([{ t: 0 }, { t: 1000 }], 999) === 0 && lrcIndexAt([{ t: 500 }], 0) === -1, 'lrcIndexAt');
