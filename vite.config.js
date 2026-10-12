import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022', // top-level await while assets load
    chunkSizeWarningLimit: 1200,
    rollupOptions: { input: { main: 'index.html' } },
  },
});
