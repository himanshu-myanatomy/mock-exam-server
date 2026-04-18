import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.VITE_PORT) || 5173,
    /** Fail fast if port taken — avoids examUrl pointing at 5173 while Vite is on 5174 */
    strictPort: true,
  },
  preview: {
    port: 4173,
  },
});
