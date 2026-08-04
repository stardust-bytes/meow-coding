import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'

function devCspRelax(): Plugin {
  return {
    name: 'dev-csp-relax',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        if (!ctx.server) return html
        return html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
      }
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [react(), devCspRelax()],
    resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } }
  }
})
