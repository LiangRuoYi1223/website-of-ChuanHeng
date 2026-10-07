import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:3001',
      '/uploads': 'http://127.0.0.1:3001',
      '/images': 'http://127.0.0.1:3001',
      '/docs': 'http://127.0.0.1:3001',
    },
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/data/**', '**/artifacts/**'] } },
  preview: { proxy: {
    '/api': 'http://127.0.0.1:3001',
    '/uploads': 'http://127.0.0.1:3001',
    '/images': 'http://127.0.0.1:3001',
    '/docs': 'http://127.0.0.1:3001',
  } },
  build: { target: 'es2022' }
});
