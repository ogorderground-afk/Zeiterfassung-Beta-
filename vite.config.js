import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { readFileSync } from 'fs'

// Serviert src/sw.js im Dev-Server unter /sw.js (mit define-Ersatz für __CACHE_VER__)
function swDevPlugin() {
  return {
    name: 'sw-dev-server',
    configureServer(server) {
      server.middlewares.use('/sw.js', (_req, res) => {
        try {
          const code = readFileSync(resolve(process.cwd(), 'src/sw.js'), 'utf-8')
            .replace('__CACHE_VER__', '"zeittracker-dev"')
          res.setHeader('Content-Type', 'application/javascript')
          res.setHeader('Service-Worker-Allowed', '/')
          res.setHeader('Cache-Control', 'no-store')
          res.end(code)
        } catch {
          res.statusCode = 404
          res.end()
        }
      })
    },
  }
}

export default defineConfig({
  // Vite ersetzt __CACHE_VER__ zur Build-Zeit in allen verarbeiteten Dateien
  define: {
    __CACHE_VER__: JSON.stringify(`zeittracker-${Date.now()}`),
  },
  plugins: [react(), swDevPlugin()],
  build: {
    target: 'es2020',
    minify: 'terser',
    rollupOptions: {
      input: {
        // Normaler App-Entry via index.html
        index: resolve(process.cwd(), 'index.html'),
        // sw.js als eigener Entry → dist/sw.js (Vite wendet define darauf an)
        sw: resolve(process.cwd(), 'src/sw.js'),
      },
      output: {
        // sw → dist/sw.js (kein Hash, SW-URL muss stabil sein)
        // App → dist/assets/[name]-[hash].js
        entryFileNames: (info) =>
          info.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
  },
  server: {
    port: 3000,
    open: true,
  },
})
