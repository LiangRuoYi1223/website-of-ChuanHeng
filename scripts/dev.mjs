import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = '127.0.0.1';
const apiPort = 3001;
const webPort = 5173;

function checkPort(port) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', error => {
      const reason = error.code === 'EADDRINUSE'
        ? `端口 ${port} 已被占用，请先停止已有的开发服务再重试。`
        : `无法使用端口 ${port}：${error.message}`;
      reject(new Error(reason));
    });
    probe.listen({ port, host }, () => probe.close(resolve));
  });
}

try {
  await Promise.all([checkPort(webPort), checkPort(apiPort)]);
  const processes = [];
  let stopped = false;
  function stop() {
    if (stopped) return;
    stopped = true;
    for (const child of processes) {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    }
    const forceStop = setTimeout(() => {
      for (const child of processes) {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }
    }, 3000);
    forceStop.unref();
  }

  for (const args of [
    ['server/index.mjs'],
    ['node_modules/vite/bin/vite.js', '--host', host, '--port', String(webPort), '--strictPort'],
  ]) {
    const child = spawn(process.execPath, args, {
      cwd: projectRoot,
      stdio: 'inherit',
      env: { ...process.env, HOST: host, PORT: String(apiPort) },
    });
    processes.push(child);
    child.on('error', error => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
      stop();
    });
    child.on('exit', (code, signal) => {
      if (!stopped && (code || signal)) process.exitCode = code ?? 1;
      stop();
    });
  }
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
