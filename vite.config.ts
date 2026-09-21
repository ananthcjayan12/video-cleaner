import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Multiple dev stacks cannot safely share the single local API on 3001.
    // Fail a duplicate launch instead of silently moving it to 5174/5175.
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:3001',
    },
  },
});
