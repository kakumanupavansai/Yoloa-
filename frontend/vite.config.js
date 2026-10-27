import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test-setup.js',
    // The page-heavy jsdom suites each transform several lazy routes. Keep parallel
    // workers bounded so concurrent transforms do not starve test timers on modest PCs.
    maxWorkers: 2,
    minWorkers: 1,
  },
  server: {
    port: 5173,
    // Transform the first screen's modules as soon as the server starts, instead of when the browser first asks for them.
    warmup: { clientFiles: ['./src/main.jsx', './src/App.jsx', './src/pages/*.jsx'] },
    // VITE_PROXY_TARGET lets a second dev server point at another Django instance (e.g. the e2e database).
    // 127.0.0.1 matches `manage.py runserver`'s default address; "localhost" tries IPv6 (::1) first on Windows, which is refused.
    // /ws carries the messaging WebSocket to Django (Daphne); the browser's Origin header is passed through unchanged
    // so Django can check it against CSRF_TRUSTED_ORIGINS / WEBSOCKET_ALLOWED_ORIGINS.
    proxy: {
      '/api': { target: process.env.VITE_PROXY_TARGET || 'http://127.0.0.1:8000', changeOrigin: true },
      '/ws': { target: process.env.VITE_PROXY_TARGET || 'http://127.0.0.1:8000', changeOrigin: true, ws: true },
    },
  },
})
