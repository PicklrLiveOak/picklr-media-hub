// Builds the app icons + header logo from the official Picklr files in /assets.
//   node scripts/make-icons.mjs
// (sharp comes with @vite-pwa/assets-generator)
import sharp from 'sharp';

const INK = '#0B0B0C';
const mark = 'assets/picklr-mark.png';            // blue "P", 512x512, transparent
const wordmark = 'assets/picklr-wordmark-white.png'; // white PICKLR wordmark

// The "P" centered on brand black. `scale` = how much of the square the P fills.
async function icon(size, scale, out) {
  const inner = Math.round(size * scale);
  const p = await sharp(mark).resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: INK } })
    .composite([{ input: p, gravity: 'centre' }])
    .png().toFile(out);
  console.log('✓', out);
}

await icon(64, 0.7, 'public/pwa-64x64.png');
await icon(192, 0.62, 'public/pwa-192x192.png');
await icon(512, 0.62, 'public/pwa-512x512.png');
await icon(512, 0.5, 'public/maskable-icon-512x512.png'); // Android crops these to a circle
await icon(180, 0.62, 'public/apple-touch-icon-180x180.png');

// Small transparent copies for the UI (keeps page weight low)
await sharp(wordmark).resize({ width: 600 }).png({ compressionLevel: 9 }).toFile('public/picklr-wordmark-white.png');
await sharp(mark).resize(160, 160).png({ compressionLevel: 9 }).toFile('public/picklr-mark.png');
console.log('✓ public/picklr-wordmark-white.png, public/picklr-mark.png');
