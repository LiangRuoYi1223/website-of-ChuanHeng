import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Vite and esbuild must agree on cwd when Windows exposes this project via a junction.
process.chdir(realpathSync(fileURLToPath(new URL('../', import.meta.url))));
await import('../node_modules/vite/bin/vite.js');
