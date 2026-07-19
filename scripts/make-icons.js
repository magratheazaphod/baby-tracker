// Renders the app icon (violet moon-and-stars) to the PNG sizes iOS/PWA need.
// Run once: npm run make-icons
import sharp from 'sharp'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#7c3aed"/>
      <stop offset="1" stop-color="#5b21b6"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <path d="M 330 96 A 132 132 0 1 0 330 416 A 104 132 0 1 1 330 96 Z" fill="#f5f0ff"/>
  <circle cx="352" cy="176" r="14" fill="#f5f0ff"/>
  <circle cx="396" cy="256" r="10" fill="#e9dcff"/>
  <circle cx="356" cy="330" r="12" fill="#f5f0ff"/>
</svg>`

for (const size of [180, 192, 512]) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(path.join(outDir, `icon-${size}.png`))
  console.log(`icon-${size}.png`)
}
