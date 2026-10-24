import { defineConfig, Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

function swVersionPlugin(): Plugin {
  return {
    name: 'sw-version-plugin',
    closeBundle() {
      const swDistPath = path.resolve(__dirname, 'dist/sw.js')
      if (fs.existsSync(swDistPath)) {
        let content = fs.readFileSync(swDistPath, 'utf-8')
        const buildVersion = `v-${Date.now().toString(36)}`
        content = content.replace(/__SW_VERSION__/g, buildVersion)
        fs.writeFileSync(swDistPath, content)
        console.log(`[Vite] Injected SW version: ${buildVersion}`)
      }
    }
  }
}

export default defineConfig({
  plugins: [react(), swVersionPlugin()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      }
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  }
})
