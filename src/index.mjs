#!/usr/bin/env node
import { loadScore } from './load-score.mjs';
import { renderStrip } from './render-strip.mjs';
import { buildTimingMap } from './build-timing.mjs';
import { generateFrames } from './generate-frames.mjs';
import { createEncoder } from './encode-video.mjs';
import * as path from 'path';
import * as fs from 'fs';

// Parse args: node src/index.mjs <file.gp> [trackIndex] [output] [--transparent]
const args = process.argv.slice(2);
const flagTransparent = args.includes('--transparent');
const positional = args.filter((a) => !a.startsWith('--'));

const gpFile = positional[0];
const trackArg = parseInt(positional[1] || '0', 10);
const defaultExt = flagTransparent ? '.mov' : '.mp4';
const outputFile =
  positional[2] ||
  `output/${path.basename(gpFile || 'output', path.extname(gpFile || ''))}_tab${defaultExt}`;

if (!gpFile) {
  console.error('Usage: node src/index.mjs <file.gp> [trackIndex] [output] [--transparent]');
  console.error('');
  console.error('Arguments:');
  console.error('  file.gp         Guitar Pro file (.gp, .gp5, .gp4, .gp3, .gpx)');
  console.error('  trackIndex      Track number to render (default: 0)');
  console.error('  output          Output file (.mov = ProRes alpha, .mp4 = H.264, .webm = VP9 alpha)');
  console.error('  --transparent   Translucent background for video overlay compositing');
  console.error('');
  console.error('Examples:');
  console.error('  node src/index.mjs song.gp                    # Dark bg, white tabs, H.264');
  console.error('  node src/index.mjs song.gp 0 --transparent    # Alpha bg, ProRes 4444');
  console.error('  node src/index.mjs song.gp 1 out.mp4          # Track 1, standalone MP4');
  process.exit(1);
}

async function main() {
  const startTime = Date.now();

  console.log(`Loading ${path.basename(gpFile)}...`);
  const { score, settings } = await loadScore(gpFile);
  console.log(`  Title: ${score.title || '(untitled)'}`);
  console.log(
    `  Tracks: ${score.tracks.map((t, i) => `[${i}] ${t.name}`).join(', ')}`
  );
  console.log(`  Tempo: ${score.tempo} BPM`);
  console.log(`  Bars: ${score.masterBars.length}`);

  if (trackArg >= score.tracks.length) {
    console.error(
      `\nError: Track ${trackArg} does not exist. Available: 0-${score.tracks.length - 1}`
    );
    process.exit(1);
  }

  const mode = flagTransparent ? 'transparent overlay' : 'standalone (dark bg)';
  console.log(`\nRendering horizontal strip (track ${trackArg}: ${score.tracks[trackArg].name}) [${mode}]...`);
  const { pngBuffer, boundsLookup, totalWidth, totalHeight } = await renderStrip(
    score,
    settings,
    trackArg,
    { transparent: flagTransparent }
  );
  console.log(`  Strip size: ${totalWidth}x${totalHeight}px`);

  await fs.promises.mkdir('output', { recursive: true });
  const debugPath = path.join('output', 'debug_strip.png');
  await fs.promises.writeFile(debugPath, pngBuffer);
  console.log(`  Debug strip saved: ${debugPath}`);

  console.log(`\nBuilding timing map...`);
  const { beatTimings, songDurationMs } = buildTimingMap(score, boundsLookup, trackArg);
  console.log(`  Beats mapped: ${beatTimings.length}`);
  console.log(`  Song duration: ${(songDurationMs / 1000).toFixed(1)}s`);

  if (beatTimings.length > 0) {
    const first = beatTimings[0];
    const last = beatTimings[beatTimings.length - 1];
    console.log(`  First beat: ${first.ms.toFixed(0)}ms @ x=${Math.round(first.pixelX)}`);
    console.log(`  Last beat: ${last.ms.toFixed(0)}ms @ x=${Math.round(last.pixelX)}`);
  }

  const fps = 30;
  const viewportWidth = Math.min(1920, totalWidth);
  const totalFrames = Math.ceil((songDurationMs / 1000) * fps);
  console.log(`\nGenerating ${totalFrames} frames at ${fps}fps...`);

  await fs.promises.mkdir(path.dirname(outputFile), { recursive: true });

  const alphaOutput = outputFile.endsWith('.mov') || outputFile.endsWith('.webm');
  const encoder = createEncoder(outputFile, viewportWidth, totalHeight, fps, alphaOutput);

  let frameCount = 0;
  for await (const { buffer } of generateFrames(
    pngBuffer,
    beatTimings,
    songDurationMs,
    totalWidth,
    totalHeight,
    { fps, viewportWidth }
  )) {
    await encoder.write(buffer);
    frameCount++;
    if (frameCount % 100 === 0) {
      const pct = ((frameCount / totalFrames) * 100).toFixed(0);
      process.stdout.write(`\r  Frame ${frameCount}/${totalFrames} (${pct}%)`);
    }
  }

  await encoder.finish();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n\nDone in ${elapsed}s!`);
  console.log(`  Output: ${outputFile}`);
  console.log(`  Frames: ${frameCount}`);
  console.log(`  Duration: ${(songDurationMs / 1000).toFixed(1)}s`);
  console.log(`\nOpen with: open '${outputFile}'`);
}

main().catch((err) => {
  console.error('\nFATAL:', err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
