// Läuft nach vite build – ersetzt Platzhalter in dist/sw.js
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve } from 'path'

const out = resolve(process.cwd(), 'dist')
const ts  = Date.now().toString()

// 1) BUILD_TS in sw.js
const swPath = resolve(out, 'sw.js')
if (existsSync(swPath)) {
  const original = readFileSync(swPath, 'utf-8')
  const patched  = original.replace(`"zeittracker-__BUILD_TS__"`, `"zeittracker-${ts}"`)
  writeFileSync(swPath, patched)
  console.log(`[post-build] sw.js → CACHE_NAME: zeittracker-${ts}`)
} else {
  console.error('[post-build] dist/sw.js nicht gefunden!')
  process.exit(1)
}

// 2) Absolute URLs in manifest.json (wenn VITE_APP_URL gesetzt)
const appUrl = process.env.VITE_APP_URL
if (appUrl) {
  const origin       = new URL(appUrl).origin
  const manifestPath = resolve(out, 'manifest.json')
  const manifest     = JSON.parse(readFileSync(manifestPath, 'utf-8'))
  manifest.id        = `${origin}/`
  manifest.start_url = `${origin}/`
  manifest.scope     = `${origin}/`
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
  console.log(`[post-build] manifest.json → start_url: ${origin}/`)
} else {
  console.warn('[post-build] VITE_APP_URL nicht gesetzt – manifest.json bleibt relativ.')
  console.warn('             → In Vercel Project Settings setzen: VITE_APP_URL=https://deine-domain.vercel.app')
}
