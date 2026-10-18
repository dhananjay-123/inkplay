/**
 * Run the vision pipeline on every sample and write clean / set-of-marks
 * images to .out/ for eyeballing.
 *
 *   pnpm test:vision
 */
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { encodeJpeg, visionFromFile } from './node-vision';

async function main() {
  const dir = path.resolve('public/samples');
  const out = path.resolve('.out');
  mkdirSync(out, { recursive: true });
  const files = readdirSync(dir).filter((f) => f.endsWith('.jpg') && !f.includes('.thumb.'));
  for (const f of files) {
    const r = await visionFromFile(path.join(dir, f));
    const name = f.replace(/\.jpg$/, '');
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
