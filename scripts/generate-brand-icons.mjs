import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const candidates = [
  process.env.SHARP_MODULE,
  'sharp',
  join(
    homedir(),
    '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp',
  ),
].filter(Boolean);
let sharp;
for (const candidate of candidates) {
  try {
    sharp = require(candidate);
    break;
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
  }
}
if (!sharp) throw new Error('Sharp is unavailable. Set SHARP_MODULE to an existing installation.');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mark = await readFile(join(root, 'public/brand/kasa-mark.svg'), 'utf8');
const geometry = mark.match(/<g[^>]*>([\s\S]*?)<\/g>/)?.[1];
if (!geometry) throw new Error('Kasa vector geometry is missing.');

function icon({ rounded = false, maskable = false } = {}) {
  const inset = maskable ? 96 : 80;
  const scale = (512 - inset * 2) / 512;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><title>Kasa</title><rect width="512" height="512"${rounded ? ' rx="106"' : ''} fill="#122331"/><g fill="#9ecac6" transform="translate(${inset} ${inset}) scale(${scale})">${geometry}</g></svg>\n`;
}

const normal = Buffer.from(icon({ rounded: true }));
const square = Buffer.from(icon());
const maskable = Buffer.from(icon({ maskable: true }));
await writeFile(join(root, 'public/icons/icon.svg'), normal);
await writeFile(join(root, 'public/icons/maskable-icon.svg'), maskable);
for (const [name, size, source] of [
  ['icon-192.png', 192, normal],
  ['icon-512.png', 512, normal],
  ['apple-touch-icon.png', 180, square],
  ['maskable-512.png', 512, maskable],
  ['favicon-32.png', 32, normal],
]) {
  const image = sharp(source).resize(size, size);
  if (source === square || source === maskable) image.removeAlpha();
  await image.png().toFile(join(root, 'public/icons', name));
}

const sizes = [16, 32, 48];
const pngs = await Promise.all(
  sizes.map((size) => sharp(normal).resize(size, size).png().toBuffer()),
);
const directory = Buffer.alloc(6 + sizes.length * 16);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(sizes.length, 4);
let offset = directory.length;
for (let i = 0; i < sizes.length; i++) {
  const at = 6 + i * 16;
  directory.writeUInt8(sizes[i], at);
  directory.writeUInt8(sizes[i], at + 1);
  directory.writeUInt16LE(1, at + 4);
  directory.writeUInt16LE(32, at + 6);
  directory.writeUInt32LE(pngs[i].length, at + 8);
  directory.writeUInt32LE(offset, at + 12);
  offset += pngs[i].length;
}
await writeFile(join(root, 'public/favicon.ico'), Buffer.concat([directory, ...pngs]));

for (const name of ['kasa-mark', 'kasa-mark-mint', 'kasa-logo', 'kasa-logo-light']) {
  const source = await readFile(join(root, 'public/brand', `${name}.svg`));
  await sharp(source)
    .resize({ width: name.includes('logo') ? 960 : 512 })
    .png()
    .toFile(join(root, 'public/brand', `${name}.png`));
}
console.log('Kasa SVG, PNG, Apple, maskable and 16/32/48 ICO assets generated.');
