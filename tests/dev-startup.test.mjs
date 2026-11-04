import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

test('dev startup from the workspace serves real optimized browser dependencies', { timeout: 45000 }, async () => {
  const project = await realpath(fileURLToPath(new URL('../', import.meta.url)));
  const artifacts = path.join(project, 'artifacts');
  await mkdir(artifacts, { recursive: true });
  const scratch = await mkdtemp(path.join(artifacts, 'dev-startup-'));
  let child;
  let closed;
  let startupTimer;
  let output = '';
  try {
    const { scripts } = JSON.parse(await readFile(path.join(project, 'package.json'), 'utf8'));
    const [command, ...args] = scripts.dev.trim().split(/\s+/);
    assert.ok(command === 'vite' || command === 'node', 'dev must use vite or a Node launcher');
    const entry = command === 'vite' ? path.join(project, 'node_modules/vite/bin/vite.js') : args.shift();
    assert.ok(entry, 'dev must provide its executable entry');
    const originalArgs = [];
    for (let index = 0; index < args.length; index++) {
      if (/^--(?:host|port)=/.test(args[index])) continue;
      if (args[index] === '--host' || args[index] === '--port') { if (args[index + 1] && !args[index + 1].startsWith('-')) index++; }
      else originalArgs.push(args[index]);
    }
    const config = path.join(scratch, 'vite.config.mjs');
    await writeFile(config, `import base from ${JSON.stringify(pathToFileURL(path.join(project, 'vite.config.js')).href)};\nexport default { ...base, publicDir: false, cacheDir: ${JSON.stringify(path.join(scratch, 'cache'))} };\n`);

    // Keep the caller's logical cwd: a Windows junction previously broke esbuild's output lookup.
    child = spawn(process.execPath, [entry, ...originalArgs, '--host', '127.0.0.1', '--port', '0', '--force', '--config', config], {
      cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    });
    closed = new Promise(resolve => child.once('close', resolve));
    const origin = await new Promise((resolve, reject) => {
      startupTimer = setTimeout(() => reject(new Error(`dev did not start within 15 seconds\n${output}`)), 15000);
      const capture = chunk => {
        output = (output + chunk.toString()).slice(-8000);
        const url = output.replace(/\x1b\[[0-9;]*m/g, '').match(/Local:\s+(http:\/\/127\.0\.0\.1:\d+)\//)?.[1];
        if (url) { clearTimeout(startupTimer); resolve(url); }
      };
      child.stdout.on('data', capture);
      child.stderr.on('data', capture);
      child.once('error', reject);
      child.once('exit', code => reject(new Error(`dev exited before startup (${code})\n${output}`)));
    });
    const signal = AbortSignal.timeout(15000);
    const admin = await fetch(`${origin}/src/pages/Admin.jsx`, { signal });
    assert.equal(admin.status, 200, `Admin module must load\n${output}`);
    const source = await admin.text();
    const dependency = source.match(/["']([^"']*lucide-react\.js\?v=[^"']+)["']/)?.[1];
    assert.ok(dependency, `Admin must import its versioned optimized lucide dependency\n${output}`);
    const url = new URL(dependency, origin);
    assert.equal(url.origin, origin, 'dependency requests must stay on the local test server');
    const response = await fetch(url, { signal });
    assert.equal(response.status, 200, `optimized lucide dependency must load\n${output}`);
    assert.match(response.headers.get('content-type') || '', /javascript/, `dependency must be JavaScript\n${output}`);
    assert.ok((await response.text()).length > 0, 'dependency must have a nonempty JavaScript body');
  } catch (error) {
    error.message += `\nVite output:\n${output}`;
    throw error;
  } finally {
    clearTimeout(startupTimer);
    if (child) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await closed;
    }
    assert.equal(path.dirname(scratch), artifacts);
    assert.equal((await lstat(scratch)).isSymbolicLink(), false);
    assert.equal(await realpath(scratch), scratch);
    await rm(scratch, { recursive: true, force: true });
  }
});
