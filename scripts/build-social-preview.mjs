import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const sharp = createRequire(new URL('../api/package.json', import.meta.url))('sharp');
const wordmark = await sharp(
  await readFile(new URL('../public/agentzuno-wordmark.svg', import.meta.url)),
)
  .resize(960, 240)
  .png()
  .toBuffer();

// Social crawlers need a raster image; keep the shared wordmark as the source.
await sharp({ create: { width: 1200, height: 630, channels: 4, background: '#090d16' } })
  .composite([{ input: wordmark, top: 195, left: 120 }])
  .png()
  .toFile(new URL('../public/agentzuno-logo-social.png', import.meta.url).pathname);
