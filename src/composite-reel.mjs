#!/usr/bin/env node
/**
 * Composite pipeline: background animation + tab overlay -> social media video.
 *
 * Usage:
 *   node src/composite-reel.mjs <file.gp> [options]
 *
 * Options:
 *   --tracks 0        Track indices (default: 0)
 *   --start-bar N     Start at bar N (default: 1)
 *   --duration N      Duration in seconds (default: 15)
 *   --platform NAME   Platform preset (default: instagram)
 *   --style NAME      Style preset (default: playthrough)
 *   --bg neon-guitar  Background animation (default: neon-guitar)
 *   --output FILE     Output file path
 */
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import sharp from 'sharp';
import { loadScore } from './load-score.mjs';
import { renderStrip, STYLE_PRESETS } from './render-strip.mjs';
import { buildTimingMap } from './build-timing.mjs';
import { generateFrames } from './generate-frames.mjs';
import { detectTuning } from './tuning.mjs';
import { createNeonRenderer } from './neon-guitar-bg.mjs';

// Platform specs (subset for vertical social)
const PLATFORMS = {
  instagram: { width: 1080, height: 1920, fps: 30, bitrate: '6M', label: 'Instagram Reels 9:16' },
  tiktok:    { width: 1080, height: 1920, fps: 30, bitrate: '8M', label: 'TikTok 9:16' },
  'youtube-shorts': { width: 1080, height: 1920, fps: 30, bitrate: '8M', label: 'YouTube Shorts 9:16' },
  youtube:   { width: 1920, height: 1080, fps: 30, bitrate: '12M', label: 'YouTube 16:9' },
};

function parseArgs(argv) {
  const opts = {
    gpFile: null,
    tracks: [0],
    startBar: 1,
    duration: 15,
    platform: 'instagram',
    style: 'playthrough',
    bg: 'neon-guitar',
    output: null,
  };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--tracks' && argv[i+1]) opts.tracks = argv[++i].split(',').map(Number);
    else if (a === '--start-bar' && argv[i+1]) opts.startBar = parseInt(argv[++i], 10);
    else if (a === '--duration' && argv[i+1]) opts.duration = parseFloat(argv[++i]);
    else if (a === '--platform' && argv[i+1]) opts.platform = argv[++i];
    else if (a === '--style' && argv[i+1]) opts.style = argv[++i];
    else if (a === '--bg' && argv[i+1]) opts.bg = argv[++i];
    else if (a === '--output' && argv[i+1]) opts.output = argv[++i];
    else if (!a.startsWith('--')) positional.push(a);
  }
  opts.gpFile = positional[0];
  if (positional[1]) opts.output = positional[1];
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
if (!opts.gpFile) {
  console.error('Usage: node src/composite-reel.mjs <file.gp> [options]');
  console.error('');
  console.error('Options:');
  console.error('  --tracks 0,2       Track indices (default: 0)');
  console.error('  --start-bar N      Start at bar N (default: 1)');
  console.error('  --duration N       Duration in seconds (default: 15)');
  console.error('  --platform NAME    instagram, tiktok, youtube-shorts, youtube');
  console.error('  --style NAME       playthrough, clean, minimal, default');
  console.error('  --bg NAME          Background: neon-guitar (default)');
  console.error('  --output FILE      Output file path');
  process.exit(1);
}

const platform = PLATFORMS[opts.platform];
if (!platform) {
  console.error(`Unknown platform: ${opts.platform}. Available: ${Object.keys(PLATFORMS).join(', ')}`);
  process.exit(1);
}

const { width: W, height: H, fps, bitrate } = platform;
const totalFrames = Math.ceil(opts.duration * fps);
const basename = path.basename(opts.gpFile, path.extname(opts.gpFile));
const outputFile = opts.output || `output/${basename}_${opts.platform}_reel.mp4`;

async function main() {
  const startTime = Date.now();
  console.log(`Composite reel: ${basename}`);
  console.log(`  Platform: ${opts.platform} (${platform.label})`);
  console.log(`  Resolution: ${W}x${H} @ ${fps}fps`);
  console.log(`  Duration: ${opts.duration}s (${totalFrames} frames)`);
  console.log(`  Background: ${opts.bg}`);
  console.log(`  Start bar: ${opts.startBar}`);
  console.log('');

  // 1. Load score
  console.log('Loading score...');
  const { score, settings } = await loadScore(opts.gpFile);
  console.log(`  ${score.title || basename} | ${score.tempo} BPM | ${score.masterBars.length} bars`);

  for (const t of opts.tracks) {
    const track = score.tracks[t];
    const tunings = track.staves[0]?.stringTuning?.tunings || [];
    if (tunings.length > 0) {
      const { name, notes } = detectTuning(tunings, tunings.length);
      console.log(`  Track ${t}: ${track.name} | ${name} (${notes})`);
    } else {
      console.log(`  Track ${t}: ${track.name}`);
    }
  }

  // 2. Resolve notation hide from style
  const stylePreset = STYLE_PRESETS[opts.style];
  const notationHide = [];
  if (stylePreset) {
    const { NOTATION_ALIASES } = await import('./render-strip.mjs');
    for (const alias of stylePreset.hide) {
      const el = NOTATION_ALIASES[alias];
      if (el !== undefined) notationHide.push(el);
    }
    console.log(`  Style: ${opts.style} (hiding ${notationHide.length} elements)`);
  }

  // 3. Render strips for each track
  console.log('\nRendering tab strips...');
  const tabScale = W < 1920 ? 1.3 : 1.0; // scale up for vertical formats
  const strips = [];
  for (const trackIdx of opts.tracks) {
    const { settings: freshSettings } = await loadScore(opts.gpFile);
    const { pngBuffer, boundsLookup, totalWidth, totalHeight } = await renderStrip(
      score, freshSettings, trackIdx,
      { transparent: true, scale: tabScale, trackColorIndex: strips.length, notationHide }
    );
    const { beatTimings, songDurationMs, sectionMarkers } = buildTimingMap(score, boundsLookup, trackIdx);
    console.log(`  Track ${trackIdx}: ${totalWidth}x${totalHeight}px, ${beatTimings.length} beats`);
    strips.push({ trackIdx, pngBuffer, totalWidth, totalHeight, beatTimings, songDurationMs, sectionMarkers });
  }

  // 4. Calculate time offset for start bar
  const bpm = score.tempo;
  const secPerBar = (4 * 60) / bpm; // assuming 4/4
  const startOffsetMs = (opts.startBar - 1) * secPerBar * 1000;
  const songDurationMs = opts.duration * 1000;
  console.log(`\n  Start offset: ${(startOffsetMs / 1000).toFixed(1)}s (bar ${opts.startBar})`);

  // Shift beat timings so startOffsetMs maps to time 0
  for (const s of strips) {
    for (const bt of s.beatTimings) {
      bt.ms -= startOffsetMs;
    }
  }

  // 5. Setup background renderer
  console.log('\nInitializing background animation...');
  const bgRenderer = createNeonRenderer(W, H, fps);

  // 6. Tab viewport dimensions
  const tabViewportWidth = W;
  const tabHeight = strips.length === 1
    ? strips[0].totalHeight
    : strips.reduce((h, s) => h + s.totalHeight, 0) + 4 * (strips.length - 1);

  // Tab vertical position: center vertically, but bias toward lower third for social safe zone
  const tabY = Math.round(H * 0.55 - tabHeight / 2);

  console.log(`  Tab viewport: ${tabViewportWidth}x${tabHeight}px at y=${tabY}`);

  // 7. Setup ffmpeg encoder
  await fs.promises.mkdir(path.dirname(outputFile), { recursive: true });

  const ffmpeg = spawn('/opt/homebrew/bin/ffmpeg', [
    '-y',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgba',
    '-s', `${W}x${H}`,
    '-r', String(fps),
    '-i', 'pipe:0',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-b:v', bitrate,
    '-maxrate', bitrate,
    '-bufsize', bitrate,
    '-preset', 'medium',
    '-movflags', '+faststart',
    outputFile,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });

  const writeFrame = (buf) => new Promise((resolve, reject) => {
    if (!ffmpeg.stdin.write(buf)) {
      ffmpeg.stdin.once('drain', resolve);
    } else {
      resolve();
    }
  });

  // 8. Generate frames: composite bg + tab
  console.log(`\nRendering ${totalFrames} frames...`);

  // Pre-generate tab frame iterators
  const tabGenerators = strips.map(s =>
    generateFrames(s.pngBuffer, s.beatTimings, songDurationMs, s.totalWidth, s.totalHeight, {
      fps,
      viewportWidth: tabViewportWidth,
      cursorColor: { r: 255, g: 50, b: 50 },
      cursorWidth: 3,
      sectionMarkers: s.sectionMarkers || [],
    })
  );
  const tabIterators = tabGenerators.map(g => g[Symbol.asyncIterator]());

  const compositeBuffer = Buffer.alloc(W * H * 4);

  for (let frame = 0; frame < totalFrames; frame++) {
    // Render background
    const bgFrame = bgRenderer.renderFrame();

    // Copy background into composite buffer
    bgFrame.copy(compositeBuffer);

    // Get tab frame(s)
    const tabResults = await Promise.all(tabIterators.map(it => it.next()));

    // Composite tab strips onto background
    let yOff = tabY;
    for (let ti = 0; ti < tabResults.length; ti++) {
      if (tabResults[ti].done) continue;
      const { buffer: tabBuf, width: tw, height: th } = tabResults[ti].value;

      // Alpha-blend tab onto composite, row by row
      for (let y = 0; y < th; y++) {
        const dstY = yOff + y;
        if (dstY < 0 || dstY >= H) continue;

        for (let x = 0; x < tw && x < W; x++) {
          const srcIdx = (y * tw + x) * 4;
          const dstIdx = (dstY * W + x) * 4;

          const sa = tabBuf[srcIdx + 3] / 255;
          if (sa === 0) continue;

          const ia = 1 - sa;
          compositeBuffer[dstIdx]     = Math.round(tabBuf[srcIdx]     * sa + compositeBuffer[dstIdx]     * ia);
          compositeBuffer[dstIdx + 1] = Math.round(tabBuf[srcIdx + 1] * sa + compositeBuffer[dstIdx + 1] * ia);
          compositeBuffer[dstIdx + 2] = Math.round(tabBuf[srcIdx + 2] * sa + compositeBuffer[dstIdx + 2] * ia);
          compositeBuffer[dstIdx + 3] = 255;
        }
      }
      yOff += th + 4; // 4px gap between tracks
    }

    await writeFrame(compositeBuffer);

    if ((frame + 1) % 30 === 0 || frame === totalFrames - 1) {
      const pct = ((frame + 1) / totalFrames * 100).toFixed(0);
      process.stdout.write(`\r  Frame ${frame + 1}/${totalFrames} (${pct}%)`);
    }
  }

  // Finish
  await new Promise((resolve) => {
    ffmpeg.stdin.end();
    ffmpeg.on('close', resolve);
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n\nDone in ${elapsed}s!`);
  console.log(`  Output: ${outputFile}`);
  console.log(`  ${W}x${H} @ ${fps}fps, ${opts.duration}s`);
  console.log(`  Platform: ${platform.label}`);
  console.log(`\nOpen with: open '${outputFile}'`);
}

main().catch(err => {
  console.error('\nFATAL:', err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
