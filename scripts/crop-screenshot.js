import sharp from 'sharp'
const [src, out] = process.argv.slice(2)
const img = sharp(src)
const { width, height } = await img.metadata()
const { data, info } = await sharp(src).raw().toBuffer({ resolveWithObject: true })
const ch = info.channels
const isMagenta = (x, y) => {
  const i = (y * info.width + x) * ch
  return data[i] > 200 && data[i + 1] < 80 && data[i + 2] > 200
}
// Scan the top row / left column for where the magenta backdrop begins.
let w = info.width
for (let x = 0; x < info.width; x++) if (isMagenta(x, 4)) { w = x; break }
let h = info.height
for (let y = 0; y < info.height; y++) if (isMagenta(4, y)) { h = y; break }
await sharp(src).extract({ left: 0, top: 0, width: w, height: h }).png().toFile(out)
console.log(`${src} ${width}x${height} -> ${w}x${h} ${out}`)
