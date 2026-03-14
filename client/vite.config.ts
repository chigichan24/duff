import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/duff/' : '/',
  plugins: [react()],
  resolve: {
    alias: {
      path: 'path-browserify',
      buffer: 'buffer',
      process: 'process',
    },
  },
  define: {
    global: 'globalThis',
  },
})
