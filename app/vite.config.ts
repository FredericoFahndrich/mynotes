import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { cloudflare } from '@cloudflare/vite-plugin'

export default defineConfig(({ mode }) => {
  const isPages = mode === 'pages'

  return {
    base: isPages ? '/mynotes/' : '/',
    plugins: isPages ? [react()] : [react(), cloudflare()],
    build: {
      outDir: 'dist',
    },
  }
})
