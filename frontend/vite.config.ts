import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `npm run dev` proxies the API to a backend on :8000 (e.g. `docker compose` with the port published).
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': process.env.API_URL ?? 'http://localhost:8000' } },
  build: {
    rollupOptions: {
      output: { manualChunks: { vendor: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'] } },
    },
  },
})
