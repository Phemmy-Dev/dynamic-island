// Runs a PowerShell helper script as a long-lived child process. Each stdout
// line is a JSON message; commands go to the script's stdin, one per line.
const { spawn } = require('child_process');
const path = require('path');

function startHelper(scriptName, { onMessage, onExit } = {}) {
  // In the installed app, the .ps1 files live outside the app.asar archive.
  const script = path.join(__dirname, scriptName).replace('app.asar', 'app.asar.unpacked');
  let child = null;
  let stopped = false;
  let restartDelay = 1000;

  function launch() {
    child = spawn('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
      // ISLAND_PID lets helpers recognise (and ignore) the island's own window.
      { windowsHide: true, env: { ...process.env, ISLAND_PID: String(process.pid) } });

    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      // Long lines (artwork) arrive split across chunks.
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        try {
          onMessage && onMessage(JSON.parse(line));
          restartDelay = 1000;
        } catch {
          // Ignore anything that isn't a JSON line.
        }
      }
    });
    child.stderr.on('data', (d) => console.error(`[${scriptName}]`, d.toString().trim()));

    child.on('exit', () => {
      child = null;
      if (stopped) return;
      onExit && onExit();
      setTimeout(launch, restartDelay);
      restartDelay = Math.min(restartDelay * 2, 30000);
    });
  }

  launch();

  return {
    send(line) {
      if (child) child.stdin.write(line + '\n');
    },
    stop() {
      stopped = true;
      if (child) child.kill();
    },
  };
}

module.exports = { startHelper };
