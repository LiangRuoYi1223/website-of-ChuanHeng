import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { realpathSync } from 'node:fs';
import { tracksVitePlugin } from './server/tracks/vite-plugin.mjs';
export default defineConfig({root:realpathSync(process.cwd()),plugins:[react(),tracksVitePlugin({localPreview:true})],build:{outDir:'dist',sourcemap:false,rollupOptions:{output:{manualChunks:{react:['react','react-dom','react-router-dom'],supabase:['@supabase/supabase-js'],geography:['./src/map/geography.json']}}}}});
