import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Build → dist/ (served by the Express server in prod).
// Dev → vite serves the SPA; proxy data + API + prototype assets to the Express server (:8080).
const API = process.env.API_ORIGIN || 'http://localhost:8080';
const proxy = (p: string) => ({ target: API, changeOrigin: true });

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      '/api': proxy('/api'),
      '/runs-artifacts': proxy('/runs-artifacts'),
      '/runs-shots': proxy('/runs-shots'),
      '/library.json': proxy('/library.json'),
      '/user-scores.json': proxy('/user-scores.json'),
      '/build-audit.json': proxy('/build-audit.json'),
      '/dashboard.json': proxy('/dashboard.json'),
      '/thumbs': proxy('/thumbs'),
      '/bench': proxy('/bench'),
      '/articles': proxy('/articles'),
      // prototype pages + acceptance shots live at root; proxy the obvious prefixes
      '^/acceptance.*': proxy('/acceptance'),
      '^/\\d+-.*\\.html$': proxy('/proto'),
      '/_prototype-shell.html': proxy('/shell'),
    },
  },
});
