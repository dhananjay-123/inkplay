/**
 * Run the vision pipeline on every sample and write clean / set-of-marks
 * images to .out/ for eyeballing.
 *
 *   pnpm test:vision                 # all samples
 *   pnpm test:vision a.jpg b.jpg     # just these files
 */
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { encodeJpeg, visionFromFile } from './node-vision';

async function main() {
  const dir = path.resolve('public/samples');
  const out = path.resolve('.out');
  mkdirSync(out, { recursive: true });
  const args = process.argv.slice(2);
  const files = args.length
    ? args.map((f) => path.resolve(f))
    : readdirSync(dir).filter((f) => f.endsWith('.jpg') && !f.includes('.thumb.')).map((f) => path.join(dir, f));
  for (const file of files) {
    const r = await visionFromFile(file);
    const name = path.basename(file).replace(/\.jpe?g$/i, '');
    writeFileSync(path.join(out, `${name}.som.jpg`), Buffer.from(encodeJpeg(r.som, 1600, 85), 'base64'));
    writeFileSync(path.join(out, `${name}.clean.jpg`), Buffer.from(encodeJpeg(r.clean, 1600, 85), 'base64'));
    const lines = r.marks.filter((m) => m.aspect > 4).length;
    console.log(`${name}: paper=${r.paperDetected} marks=${r.marks.length} (wide=${lines}) ${r.ms}ms`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
