import { defineConfig } from 'vite'

export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : '/',
  server: {
    port: 5173,
    open: false,
    fs: {
      strict: false,  // allow /@fs/ to serve VRM files from anywhere on disk
    },
  },
  build: {
    target: 'esnext',
    chunkSizeWarningLimit: 2000,
  },
}))
