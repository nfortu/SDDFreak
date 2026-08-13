import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const backendOrigin = process.env.BACKEND_ORIGIN ?? 'http://localhost:3000';

/**
 * TR-FE-004: the browser talks to the backend and to nothing else. Proxying
 * keeps that a same-origin call, so the session cookie applies and the CSRF
 * origin check (NFR-SEC-004) sees the expected origin.
 *
 * `server` and `preview` are separate configs in Vite, so both need it — a
 * proxy on only one leaves `npm run preview` unable to reach the API.
 */
const proxy = {
  '/api': { target: backendOrigin, changeOrigin: true },
  '/health': { target: backendOrigin, changeOrigin: true },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, proxy },
  preview: { port: 4173, proxy },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
