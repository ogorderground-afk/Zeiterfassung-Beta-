// Setzt absolute start_url/scope/id im manifest.json wenn VITE_APP_URL gesetzt ist.
// sw.js wird nicht mehr gepatcht – das übernimmt Vite's `define` nativ.
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve } from 'path'

const appUrl = process.env.VITE_APP_URL

if (!appUrl) {
  console.warn('[post-build] VITE_APP_URL nicht gesetzt – manifest.json bleibt relativ.')
  console.warn('             Setze VITE_APP_URL=https://deine-domain.vercel.app in Vercel Project Settings (nur Production).')
  process.exit(0)
}

const origin = new URL(appUrl).origin
const manifestPath = resolve(process.cwd(), 'dist', 'manifest.json')

if (!existsSync(manifestPath)) {
  console.error('[post-build] dist/manifest.json nicht gefunden!')
  process.exit(1)
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
manifest.id        = `${origin}/`
manifest.start_url = `${origin}/`
manifest.scope     = `${origin}/`
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
console.log(`[post-build] manifest.json → start_url: ${origin}/`)
