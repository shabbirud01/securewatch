import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // The API runs on port 4000. Forwarding /api through the dev server means the
    // browser only ever talks to one origin, so no CORS setup is needed.
    proxy: { '/api': 'http://127.0.0.1:4000' },
  },
});
