import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [solid()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
    proxy: {
      '^/api/(?!sdk/workflows/(?:index[.]js|index[.]d[.]ts|README[.]md)(?:[?]|$))': {
        target: process.env.API_URL || 'http://127.0.0.1:3001',
      },
    },
  },
  preview: {
    port: 3000,
    proxy: { '/api': { target: process.env.API_URL || 'http://127.0.0.1:3001' } },
  },
  build: { target: 'es2022' },
});
