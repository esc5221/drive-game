import { defineConfig } from 'vite';

export default defineConfig({
  base: './',                  // Capacitor WebView needs relative asset paths
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  server: { port: 8741 },
});
