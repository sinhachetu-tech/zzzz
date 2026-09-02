// One-shot icon generator for HFMC PWA.
// Renders the brand mark (amber waveform on deep-slate) to PNG via sharp.
// Run: `bun scripts/gen-icons.ts`
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const OUT = resolve("public");

const ICON_SVG = (size: number, padded = false) => {
  const bg = padded ? "#0b171d" : "none";
  const pad = padded ? size * 0.18 : 0;
  const inner = size - pad * 2;
  const cx = size / 2;
  const cy = size / 2;
  const r = inner * 0.36;
  const w = inner * 0.62;
  const x0 = cx - w / 2;
  const pts = [
    [x0, cy],
    [x0 + w * 0.22, cy - inner * 0.20],
    [x0 + w * 0.5, cy + inner * 0.22],
    [x0 + w * 0.78, cy - inner * 0.16],
    [x0 + w, cy],
  ];
  const path = pts
    .map((p, i) => (i === 0 ? `M ${p[0]} ${p[1]}` : `L ${p[0]} ${p[1]}`))
    .join(" ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${padded ? `<rect width="${size}" height="${size}" fill="${bg}"/>` : ""}
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="#F2B04C" fill-opacity="0.12"/>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#F2B04C" stroke-opacity="0.4" stroke-width="${size * 0.012}"/>
  <path d="${path}" fill="none" stroke="#F2B04C" stroke-width="${size * 0.052}" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
};

async function render(svg: string, file: string) {
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  const p = resolve(OUT, file);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, buf);
  console.log("wrote", file);
}

await render(ICON_SVG(192, false), "icon-192.png");
await render(ICON_SVG(512, false), "icon-512.png");
await render(ICON_SVG(512, true), "icon-maskable-512.png");
await render(ICON_SVG(180, true), "apple-touch-icon.png");
await render(ICON_SVG(32, false), "favicon-32.png");
console.log("done");
