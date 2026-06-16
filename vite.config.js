import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    https: false,  // HTTP is fine for localhost
    port: 5173,
  },
});
