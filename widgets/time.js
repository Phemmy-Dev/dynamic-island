// Calendar + timer view. Uses globals from renderer.js ($, pill, peek).
(() => {
  // ---------- Calendar ----------

  // First day of the week from the user's locale (1 = Monday ... 7 = Sunday).
  function firstDayOfWeek() {
    try {
      const locale = new Intl.Locale(navigator.language);
      const info = locale.getWeekInfo ? locale.getWeekInfo() : locale.weekInfo;
      if (info && info.firstDay) return info.firstDay % 7; // as Date.getDay(): 0 = Sunday
    } catch {}
    return 1;
  }

  const weekStart = firstDayOfWeek();
  const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
  const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'narrow' });

  // Weekday initials, starting on the locale's first day. Jan 4 2026 was a Sunday.
  $('cal-weekdays').innerHTML = Array.from({ length: 7 }, (_, i) =>
    `<span>${weekdayFmt.format(new Date(2026, 0, 4 + ((weekStart + i) % 7)))}</span>`).join('');

  let shownMonth = new Date();
  shownMonth.setDate(1);
  let renderedDay = '';

  function renderCalendar() {
    const today = new Date();
    renderedDay = today.toDateString();
    const year = shownMonth.getFullYear();
    const month = shownMonth.getMonth();
    $('cal-title').textContent = monthFmt.format(shownMonth);

    // Always 6 rows so the view height never changes; days outside the
    // month are dimmed.
    const lead = (new Date(year, month, 1).getDay() - weekStart + 7) % 7;
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const date = new Date(year, month, 1 - lead + i);
      const classes = [];
      if (date.getMonth() !== month) classes.push('other');
      if (date.toDateString() === renderedDay) classes.push('today');
      cells.push(`<span class="${classes.join(' ')}">${date.getDate()}</span>`);
    }
    $('cal-days').innerHTML = cells.join('');
  }

  function shiftMonth(delta) {
    shownMonth = new Date(shownMonth.getFullYear(), shownMonth.getMonth() + delta, 1);
    renderCalendar();
  }

  $('cal-prev').addEventListener('click', () => shiftMonth(-1));
  $('cal-next').addEventListener('click', () => shiftMonth(1));
  $('cal-title').addEventListener('click', () => {
    shownMonth = new Date();
    shownMonth.setDate(1);
    renderCalendar();
  });

  renderCalendar();
  // Move the "today" marker after midnight.
  setInterval(() => {
    if (new Date().toDateString() !== renderedDay) renderCalendar();
  }, 60000);

  // ---------- Timer ----------

  // State survives restarts: a running timer keeps its end time.
  // endAt is set while running; remainingMs holds the time left otherwise.
  let timer = { durationMs: 5 * 60000, remainingMs: 5 * 60000, endAt: null };
  try {
    const saved = JSON.parse(localStorage.getItem('timer'));
    if (saved && saved.durationMs > 0) timer = saved;
  } catch {}
  if (timer.endAt && timer.endAt <= Date.now()) {
    // Finished while the island wasn't running.
    timer = { durationMs: timer.durationMs, remainingMs: timer.durationMs, endAt: null };
  }

  const BELL_ICON = '<svg class="glyph" viewBox="0 0 24 24"><path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>';

  const isRunning = () => timer.endAt !== null;
  const remaining = () => (isRunning() ? Math.max(0, timer.endAt - Date.now()) : timer.remainingMs);

  function save() {
    try { localStorage.setItem('timer', JSON.stringify(timer)); } catch {}
  }

  function format(ms) {
    const total = Math.ceil(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = String(total % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
  }

  function render() {
    const text = format(remaining());
    const started = isRunning() || timer.remainingMs < timer.durationMs;
    $('timer-display').textContent = text;
    $('wing-timer').textContent = text;
    $('timer-start').textContent = isRunning() ? 'Pause' : started ? 'Resume' : 'Start';
    // The collapsed right wing shows the countdown while a timer is going.
    pill.classList.toggle('timer-active', started);
    pill.classList.toggle('timer-paused', started && !isRunning());
  }

  function start() {
    if (isRunning() || timer.remainingMs <= 0) return;
    timer.endAt = Date.now() + timer.remainingMs;
    save();
    render();
  }

  function pause() {
    if (!isRunning()) return;
    timer.remainingMs = remaining();
    timer.endAt = null;
    save();
    render();
  }

  function reset() {
    timer = { durationMs: timer.durationMs, remainingMs: timer.durationMs, endAt: null };
    save();
    render();
  }

  function setDuration(ms) {
    ms = Math.min(24 * 3600000, Math.max(60000, ms));
    timer = { durationMs: ms, remainingMs: ms, endAt: null };
    save();
    render();
  }

  // Three soft beeps. (main.js allows audio without a prior click.)
  function chime() {
    try {
      const ctx = new AudioContext();
      [0, 0.35, 0.7].forEach((offset) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = 880;
        osc.connect(gain).connect(ctx.destination);
        const t = ctx.currentTime + offset;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
        osc.start(t);
        osc.stop(t + 0.3);
      });
      setTimeout(() => ctx.close(), 1500);
    } catch {}
  }

  function finish() {
    reset();
    chime();
    peek(BELL_ICON, 1, 'Done', 8000);
    const display = $('timer-display');
    display.classList.remove('done');
    void display.offsetWidth; // restart the flash animation
    display.classList.add('done');
  }

  setInterval(() => {
    if (!isRunning()) return;
    if (remaining() <= 0) finish();
    else render();
  }, 250);

  $('timer-start').addEventListener('click', () => (isRunning() ? pause() : start()));
  $('timer-reset').addEventListener('click', reset);
  document.querySelectorAll('[data-minutes]').forEach((btn) => btn.addEventListener('click', () => {
    setDuration(+btn.dataset.minutes * 60000);
    start();
  }));

  // Scroll over the time to change it by a minute (only while stopped).
  $('timer-display').islandWheel = (step) => {
    if (isRunning()) return;
    setDuration(Math.round(timer.remainingMs / 60000) * 60000 + step * 60000);
  };

  render();
})();
