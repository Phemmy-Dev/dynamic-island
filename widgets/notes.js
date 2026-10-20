// Quick notes view: one scratchpad, saved as you type. Uses globals from
// renderer.js ($, pinned).
(() => {
  const box = $('notes');
  const status = $('notes-status');
  let saveTimer = null;

  try { box.value = localStorage.getItem('notes') || ''; } catch {}

  function save() {
    try {
      localStorage.setItem('notes', box.value);
      status.textContent = 'Saved';
    } catch {
      status.textContent = 'Not saved';
    }
  }

  box.addEventListener('input', () => {
    status.textContent = '';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 400);
  });

  // Keep the island open while typing, even if the mouse drifts away.
  // Clicking another window (or Escape) still closes it.
  box.addEventListener('focus', () => { pinned = true; });
  box.addEventListener('blur', () => {
    clearTimeout(saveTimer);
    save();
  });
})();
