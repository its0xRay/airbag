import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// @solana/web3.js expects a global Buffer in the browser.
import { Buffer } from 'buffer'
;(globalThis as unknown as { Buffer: typeof Buffer }).Buffer ||= Buffer
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
