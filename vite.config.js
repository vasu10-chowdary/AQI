import { defineConfig } from 'vite';

// Relative base keeps the build portable across static hosts and sub-paths.
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    sourcemap: false,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
});
