#!/usr/bin/env node
/*
 * Regenerate raster app icons and favicons from the shared UI logo icon.
 *
 * Run with:  node scripts/generate-icons.mjs
 *
 * Requires: sharp, png-to-ico  (pnpm add -w -D sharp png-to-ico)
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pngToIco from "png-to-ico";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const sharedSvgPath = path.join(root, "packages/ui/src/assets/logo-icon.svg");
const buildDir = path.join(__dirname, "build");

const pngFrom = (sourcePath, size) =>
  sharp(sourcePath).resize(size, size).png({ compressionLevel: 9 }).toBuffer();

async function main() {
  await mkdir(buildDir, { recursive: true });
  const sharedSvg = await readFile(sharedSvgPath);
  if (!sharedSvg.length) throw new Error("Shared icon SVG is empty");

  // Favicons — multi-res .ico from 16/32/48
  const favSizes = [16, 32, 48];
  const favBufs = await Promise.all(
    favSizes.map((size) => pngFrom(sharedSvgPath, size)),
  );
  const ico = await pngToIco(favBufs);
  await writeFile(path.join(root, "apps/nextjs/public/favicon.ico"), ico);

  console.log("Icons generated.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
