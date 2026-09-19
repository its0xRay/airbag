import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// @solana/web3.js is written for Node and expects `Buffer` and `global`.
// Without these, dev externalizes the `buffer` module and transaction
// serialization fails at runtime (silently, only when you try to sign).
export default defineConfig({
  plugins: [react()],
  define: {
    global: 'globalThis',
  },
  resolve: {
    alias: {
      buffer: 'buffer/',
    },
  },
  optimizeDeps: {
    include: ['buffer', '@solana/web3.js'],
  },
})
