import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const extension = path.join(root, 'extension');
// Generate our own tiny antialiased ghost icon without a runtime or image dependency.
function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ -1) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type), size = Buffer.alloc(4), crc = Buffer.alloc(4);
  size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([size, name, data, crc]);
}
function pixel(x, y) {
  const corner = Math.hypot(Math.max(Math.abs(x - 24) - 10, 0), Math.max(Math.abs(y - 24) - 10, 0));
  if (corner > 14) return [0, 0, 0, 0];
  const purple = [114, 85, 219, 255];
  const body = x >= 12 && x <= 36 && ((y <= 22 && (x - 24) ** 2 + (y - 22) ** 2 <= 144) || (y >= 22 && y <= 33 + 2 * Math.cos((x - 12) * Math.PI / 6)));
  if (!body) return purple;
  if ([20, 28].some(cx => ((x - cx) / 1.6) ** 2 + ((y - 23) / 2.6) ** 2 <= 1)) return purple;
  return [255, 255, 255, 255];
}
function png(size) {
  const bytes = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const rgba = [0, 0, 0, 0];
    for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) {
      pixel((x + (dx + .5) / 4) * 48 / size, (y + (dy + .5) / 4) * 48 / size).forEach((v, i) => { rgba[i] += v / 16; });
    }
    for (let i = 0; i < 4; i++) bytes[y * (size * 4 + 1) + 1 + x * 4 + i] = Math.round(rgba[i]);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(bytes)), chunk('IEND', Buffer.alloc(0))]);
}
for (const size of [16, 32, 48, 128]) await writeFile(path.join(extension, `icons/${size}.png`), png(size));
const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
if (manifest.manifest_version !== 3 || manifest.host_permissions) throw new Error('Unexpected extension permissions.');
const dest = path.join(root, 'dist', 'ghost-typer');
await mkdir(dest, { recursive: true });
await cp(extension, dest, { recursive: true });
// Python's standard library creates a fresh ZIP, so removed files cannot linger in the archive.
execFileSync('python3', ['-c', 'import pathlib,sys,zipfile; root=pathlib.Path(sys.argv[1]); z=zipfile.ZipFile(sys.argv[2],"w",zipfile.ZIP_DEFLATED); [z.write(p,p.relative_to(root)) for p in sorted(root.rglob("*")) if p.is_file()]; z.close()', extension, path.join(root, 'dist', 'ghost-typer.zip')]);
console.log('Built dist/ghost-typer and dist/ghost-typer.zip. No install-time website permissions.');
