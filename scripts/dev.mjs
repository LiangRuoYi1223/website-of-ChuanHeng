import { spawn } from 'node:child_process';
const processes = [
  spawn(process.execPath, ['server/index.mjs'], { stdio: 'inherit' }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], { stdio: 'inherit' }),
];
let stopped = false;
function stop() { if (stopped) return; stopped = true; for (const child of processes) child.kill(); }
for (const child of processes) {
  child.on('error', error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; stop(); });
  child.on('exit', code => { if (code && !stopped) process.exitCode = code; stop(); });
}
process.on('SIGINT', stop); process.on('SIGTERM', stop);
