import { defineConfig } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  base: './',                  // Capacitor WebView needs relative asset paths
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        logic: resolve(root, 'data/game_logic.html'),   // /data/game_logic.html sub-page
      },
    },
  },
  server: { port: 8741 },
});
