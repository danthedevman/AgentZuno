import { createRequire } from 'node:module';
const sharp = createRequire(new URL('../api/package.json', import.meta.url))('sharp');
import { readFile } from 'node:fs/promises';
const background = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><defs><radialGradient id="glow"><stop stop-color="#818cf8" stop-opacity=".18"/><stop offset="1" stop-color="#090d16" stop-opacity="0"/></radialGradient></defs><rect width="1200" height="630" fill="#090d16"/><ellipse cx="600" cy="260" rx="610" ry="440" fill="url(#glow)"/><text x="600" y="445" text-anchor="middle" font-family="Arial,sans-serif" font-size="30" fill="#b8c3d8">Open source AI help desk</text></svg>`,
);
const wordmark = await sharp(
  await readFile(new URL('../public/agentzuno-wordmark.svg', import.meta.url)),
)
  .resize(800, 200)
  .png()
  .toBuffer();
await sharp(background)
  .composite([{ input: wordmark, top: 205, left: 200 }])
  .png()
  .toFile(new URL('../public/agentzuno-social.png', import.meta.url).pathname);
