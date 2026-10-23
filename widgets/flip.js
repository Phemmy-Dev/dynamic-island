// Flips an album-art <img> like a card when the song changes, swapping in the
// new picture halfway through (when it's edge-on). Needs the .flip animation
// from styles.css / ambient.css. Shared by the island and the Now Playing screen.
const FLIP_MS = 400;

function flipImage(img, src) {
  const swap = () => (src ? (img.src = src) : img.removeAttribute('src'));
  // Nothing to flip away from yet, or the user asked Windows for less motion.
  if (!img.getAttribute('src') || matchMedia('(prefers-reduced-motion: reduce)').matches) return swap();
  img.classList.remove('flip');
  void img.offsetWidth;  // restart the animation if songs change quickly
  img.classList.add('flip');
  setTimeout(swap, FLIP_MS / 2);
}
