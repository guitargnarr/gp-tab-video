import * as alphaTab from '@coderline/alphatab';
import * as alphaSkia from '@coderline/alphaskia';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const Color = alphaTab.model.Color;

/**
 * @param {object} score - alphaTab Score object
 * @param {object} settings - alphaTab Settings object
 * @param {number} trackIndex - which track to render
 * @param {object} opts - rendering options
 * @param {boolean} opts.transparent - true for translucent overlay mode (alpha bg + white notation)
 * @param {number} opts.scale - notation scale factor (default 1.0, try 1.3-1.5 for larger tab numbers)
 */
export async function renderStrip(score, settings, trackIndex = 0, opts = {}) {
  const transparent = opts.transparent ?? false;
  const scale = opts.scale ?? 1.0;

  // Initialize alphaSkia with Bravura music font (OTF)
  const bravuraPath = path.join(
    PROJECT_ROOT,
    'node_modules/@coderline/alphatab/dist/font/Bravura.otf'
  );
  const bravuraData = await fs.promises.readFile(bravuraPath);
  alphaTab.Environment.enableAlphaSkia(bravuraData.buffer, alphaSkia);

  // Configure for horizontal strip rendering
  settings.core.engine = 'skia';
  settings.display.layoutMode = alphaTab.LayoutMode.Horizontal;
  settings.display.scale = scale;

  // Tab-only rendering
  for (const track of score.tracks) {
    for (const staff of track.staves) {
      staff.showTablature = true;
      staff.showStandardNotation = false;
    }
  }

  // White notation colors for contrast on dark/transparent backgrounds
  const res = settings.display.resources;
  const white = new Color(255, 255, 255, 255);
  const lightGray = new Color(180, 180, 180, 255);
  const dimGray = new Color(100, 100, 100, 255);

  res.mainGlyphColor = white;           // Tab numbers, note heads
  res.staffLineColor = lightGray;        // String lines
  res.barSeparatorColor = dimGray;       // Bar lines
  res.barNumberColor = lightGray;        // Bar numbers
  res.secondaryGlyphColor = lightGray;   // Secondary notation elements
  res.scoreInfoColor = white;            // Title/metadata

  // Create renderer with large width to prevent wrapping
  const renderer = new alphaTab.rendering.ScoreRenderer(settings);
  renderer.width = 99999;

  // Track partial render IDs for compositing
  let partialIds = [];
  let totalWidth = 0;
  let totalHeight = 0;
  let renderDone = false;

  const canvas = new alphaSkia.AlphaSkiaCanvas();

  renderer.preRender.on(() => {
    partialIds = [];
  });

  renderer.partialLayoutFinished.on((r) => {
    partialIds.push(r.id);
  });

  renderer.renderFinished.on((r) => {
    totalWidth = Math.ceil(r.totalWidth);
    totalHeight = Math.ceil(r.totalHeight);

    canvas.beginRender(totalWidth, totalHeight);
    if (transparent) {
      // Fully transparent background for video overlay compositing
      canvas.color = alphaSkia.AlphaSkiaCanvas.rgbaToColor(0, 0, 0, 0);
    } else {
      // Dark background for standalone viewing
      canvas.color = alphaSkia.AlphaSkiaCanvas.rgbaToColor(20, 20, 20, 255);
    }
    canvas.fillRect(0, 0, totalWidth, totalHeight);

    for (const id of partialIds) {
      renderer.renderResult(id);
    }
    renderDone = true;
  });

  renderer.partialRenderFinished.on((r) => {
    canvas.drawImage(r.renderResult, r.x, r.y, r.width, r.height);
    r.renderResult[Symbol.dispose]();
  });

  // Render the score (synchronous in Node.js)
  renderer.renderScore(score, [trackIndex]);

  if (!renderDone) {
    throw new Error('Render did not complete. Check score data.');
  }

  // Extract PNG
  const image = canvas.endRender();
  const pngBuffer = new Uint8Array(image.toPng());
  image[Symbol.dispose]();
  canvas[Symbol.dispose]();

  // Extract bounds lookup for beat positions
  const boundsLookup = renderer.boundsLookup;

  return { pngBuffer, boundsLookup, totalWidth, totalHeight };
}
