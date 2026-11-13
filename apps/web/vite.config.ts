import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const api = process.env.API_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': api,
      '/mcp': api,
      '/.well-known': api,
    },
  },
  build: {
    target: 'es2024',
    sourcemap: true,
    rollupOptions: {
      // The embed widget is its own file with a stable name, so other sites can load /widget.js.
      input: {
        main: fileURLToPath(new URL('index.html', import.meta.url)),
        widget: fileURLToPath(new URL('src/widget/widget.ts', import.meta.url)),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'widget' ? 'widget.js' : 'assets/[name]-[hash].js'),
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
