#!/usr/bin/env node
import { loadScore } from './load-score.mjs';
import { renderStrip } from './render-strip.mjs';
import { buildTimingMap } from './build-timing.mjs';
import { generateFrames } from './generate-frames.mjs';
import { createEncoder } from './encode-video.mjs';
import * as path from 'path';
import * as fs from 'fs';

// --- Arg parsing ---
function parseArgs(argv) {
  const opts = {
    gpFile: null,
    tracks: [0],
    output: null,
    transparent: false,
    fps: 30,
    width: 1920,
    video: null,       // playthrough footage for composite
    cursorColor: 'red',
    cursorWidth: 3,
    scale: 1.0,        // notation scale factor
  };

  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--transparent') {
      opts.transparent = true;
    } else if (a === '--fps' && argv[i + 1]) {
      opts.fps = parseInt(argv[++i], 10);
    } else if (a === '--width' && argv[i + 1]) {
      opts.width = parseInt(argv[++i], 10);
    } else if (a === '--tracks' && argv[i + 1]) {
      opts.tracks = argv[++i].split(',').map((t) => parseInt(t, 10));
    } else if (a === '--video' && argv[i + 1]) {
      opts.video = argv[++i];
    } else if (a === '--cursor-color' && argv[i + 1]) {
      opts.cursorColor = argv[++i];
    } else if (a === '--cursor-width' && argv[i + 1]) {
      opts.cursorWidth = parseInt(argv[++i], 10);
    } else if (a === '--scale' && argv[i + 1]) {
      opts.scale = parseFloat(argv[++i]);
    } else if (!a.startsWith('--')) {
      positional.push(a);
    }
  }

  opts.gpFile = positional[0];
  if (positional[1] && /^\d+(,\d+)*$/.test(positional[1])) {
    opts.tracks = positional[1].split(',').map((t) => parseInt(t, 10));
  }
  if (positional[2]) opts.output = positional[2];

  return opts;
}

const opts = parseArgs(process.argv.slice(2));

if (!opts.gpFile) {
  console.error('Usage: node src/index.mjs <file.gp> [tracks] [output] [options]');
  console.error('');
  console.error('Arguments:');
  console.error('  file.gp           Guitar Pro file (.gp, .gp5, .gp4, .gp3, .gpx)');
  console.error('  tracks            Track numbers (default: 0). Comma-separated for multi: 0,1');
  console.error('  output            Output file (.mov = ProRes alpha, .mp4 = H.264)');
  console.error('');
  console.error('Options:');
  console.error('  --transparent     Alpha background for overlay compositing');
  console.error('  --fps N           Frame rate: 24, 30, 60 (default: 30)');
  console.error('  --width N         Viewport width in px (default: 1920). Use 3840 for 4K');
  console.error('  --video FILE      Playthrough footage to composite tab overlay onto');
  console.error('  --tracks 0,1      Track indices to render (multi-track stacked)');
  console.error('  --scale N         Notation scale factor (default: 1.0)');
  console.error('  --cursor-color C  Cursor color: red, white, cyan, etc (default: red)');
  console.error('  --cursor-width N  Cursor width in px (default: 3)');
  console.error('');
  console.error('Examples:');
  console.error('  node src/index.mjs song.gp                              # 1080p 30fps standalone');
  console.error('  node src/index.mjs song.gp 0 --transparent --fps 60     # 60fps overlay');
  console.error('  node src/index.mjs song.gp 0,1 --width 3840 --fps 60   # 4K multi-track');
  console.error('  node src/index.mjs song.gp 0 --video playthrough.mp4   # Composite');
  process.exit(1);
}

const defaultExt = opts.transparent || opts.video ? '.mov' : '.mp4';
const outputFile =
  opts.output ||
  `output/${path.basename(opts.gpFile, path.extname(opts.gpFile))}_tab${defaultExt}`;

// --- Cursor color parsing ---
const CURSOR_COLORS = {
  red: { r: 255, g: 50, b: 50 },
  white: { r: 255, g: 255, b: 255 },
  cyan: { r: 0, g: 255, b: 255 },
  green: { r: 50, g: 255, b: 50 },
  yellow: { r: 255, g: 255, b: 50 },
  orange: { r: 255, g: 165, b: 0 },
};
const cursorRgb = CURSOR_COLORS[opts.cursorColor] || CURSOR_COLORS.red;

async function main() {
  const startTime = Date.now();

  console.log(`Loading ${path.basename(opts.gpFile)}...`);
  const { score, settings } = await loadScore(opts.gpFile);
  console.log(`  Title: ${score.title || '(untitled)'}`);
  console.log(
    `  Tracks: ${score.tracks.map((t, i) => `[${i}] ${t.name}`).join(', ')}`
  );
  console.log(`  Tempo: ${score.tempo} BPM`);
  console.log(`  Bars: ${score.masterBars.length}`);

  for (const t of opts.tracks) {
    if (t >= score.tracks.length) {
      console.error(`\nError: Track ${t} does not exist. Available: 0-${score.tracks.length - 1}`);
      process.exit(1);
    }
  }

  // Render each track as a strip
  const strips = [];
  for (const trackIdx of opts.tracks) {
    const mode = opts.transparent ? 'transparent' : 'dark bg';
    console.log(`\nRendering track ${trackIdx}: ${score.tracks[trackIdx].name} [${mode}]...`);

    // Clone settings for each track render (avoid mutation)
    const { settings: freshSettings } = await loadScore(opts.gpFile);
    const { pngBuffer, boundsLookup, totalWidth, totalHeight } = await renderStrip(
      score,
      freshSettings,
      trackIdx,
      { transparent: opts.transparent, scale: opts.scale }
    );
    console.log(`  Strip size: ${totalWidth}x${totalHeight}px`);

    const { beatTimings, songDurationMs } = buildTimingMap(score, boundsLookup, trackIdx);
    console.log(`  Beats mapped: ${beatTimings.length}`);
    console.log(`  Song duration: ${(songDurationMs / 1000).toFixed(1)}s`);

    strips.push({ trackIdx, pngBuffer, totalWidth, totalHeight, beatTimings, songDurationMs });
  }

  // Use the longest duration across tracks
  const songDurationMs = Math.max(...strips.map((s) => s.songDurationMs));

  // Save debug strips
  await fs.promises.mkdir('output', { recursive: true });
  for (const s of strips) {
    const debugPath = `output/debug_strip_track${s.trackIdx}.png`;
    await fs.promises.writeFile(debugPath, s.pngBuffer);
    console.log(`  Debug strip: ${debugPath}`);
  }

  // For multi-track: stack strips vertically
  const viewportWidth = Math.min(opts.width, strips[0].totalWidth);
  let outputHeight;
  if (strips.length === 1) {
    outputHeight = strips[0].totalHeight;
  } else {
    // Stack with 4px gap between tracks
    const gap = 4;
    outputHeight = strips.reduce((h, s) => h + s.totalHeight, 0) + gap * (strips.length - 1);
  }

  const totalFrames = Math.ceil((songDurationMs / 1000) * opts.fps);
  console.log(`\nGenerating ${totalFrames} frames at ${opts.fps}fps (${viewportWidth}x${outputHeight})...`);

  await fs.promises.mkdir(path.dirname(outputFile), { recursive: true });

  // Determine output format
  let encoderOutput = outputFile;
  let compositeAfter = false;
  if (opts.video) {
    // Render tab to temp file, then composite
    encoderOutput = outputFile.replace(/\.\w+$/, '_tab_only.mov');
    compositeAfter = true;
  }

  const alphaOutput = encoderOutput.endsWith('.mov') || encoderOutput.endsWith('.webm');
  const encoder = createEncoder(encoderOutput, viewportWidth, outputHeight, opts.fps, alphaOutput);

  let frameCount = 0;

  if (strips.length === 1) {
    // Single track -- direct pipeline
    const s = strips[0];
    for await (const { buffer } of generateFrames(
      s.pngBuffer,
      s.beatTimings,
      songDurationMs,
      s.totalWidth,
      s.totalHeight,
      {
        fps: opts.fps,
        viewportWidth,
        cursorColor: cursorRgb,
        cursorWidth: opts.cursorWidth,
      }
    )) {
      await encoder.write(buffer);
      frameCount++;
      if (frameCount % 100 === 0) {
        const pct = ((frameCount / totalFrames) * 100).toFixed(0);
        process.stdout.write(`\r  Frame ${frameCount}/${totalFrames} (${pct}%)`);
      }
    }
  } else {
    // Multi-track -- generate frames for each track, stack vertically per frame
    const sharp = (await import('sharp')).default;
    const generators = strips.map((s) =>
      generateFrames(s.pngBuffer, s.beatTimings, songDurationMs, s.totalWidth, s.totalHeight, {
        fps: opts.fps,
        viewportWidth,
        cursorColor: cursorRgb,
        cursorWidth: opts.cursorWidth,
      })
    );

    const iterators = generators.map((g) => g[Symbol.asyncIterator]());
    const gap = 4;

    while (frameCount < totalFrames) {
      const results = await Promise.all(iterators.map((it) => it.next()));
      if (results.some((r) => r.done)) break;

      const composites = [];
      let yOffset = 0;
      for (let i = 0; i < results.length; i++) {
        const { buffer, height } = results[i].value;
        composites.push({
          input: Buffer.from(buffer),
          raw: { width: viewportWidth, height, channels: 4 },
          top: yOffset,
          left: 0,
        });
        yOffset += height + gap;
      }

      const combined = await sharp({
        create: {
          width: viewportWidth,
          height: outputHeight,
          channels: 4,
          background: opts.transparent
            ? { r: 0, g: 0, b: 0, alpha: 0 }
            : { r: 20, g: 20, b: 20, alpha: 255 },
        },
      })
        .composite(composites)
        .raw()
        .toBuffer();

      await encoder.write(combined);
      frameCount++;
      if (frameCount % 100 === 0) {
        const pct = ((frameCount / totalFrames) * 100).toFixed(0);
        process.stdout.write(`\r  Frame ${frameCount}/${totalFrames} (${pct}%)`);
      }
    }
  }

  await encoder.finish();
  console.log('');

  // Composite over playthrough footage if --video provided
  if (compositeAfter && opts.video) {
    console.log(`\nCompositing over ${path.basename(opts.video)}...`);
    const { execSync } = await import('child_process');
    const ffmpegCmd = [
      '/opt/homebrew/bin/ffmpeg', '-y',
      '-i', opts.video,
      '-i', encoderOutput,
      '-filter_complex',
      `[1:v]scale=-1:ih*0.25[tab];[0:v][tab]overlay=0:H-h-20`,
      '-c:v', 'libx264', '-crf', '18',
      '-c:a', 'copy',
      outputFile,
    ].map((a) => `"${a}"`).join(' ');
    execSync(ffmpegCmd, { stdio: 'inherit' });

    // Clean up temp tab-only file
    await fs.promises.unlink(encoderOutput).catch(() => {});
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nDone in ${elapsed}s!`);
  console.log(`  Output: ${outputFile}`);
  console.log(`  Frames: ${frameCount}`);
  console.log(`  Duration: ${(songDurationMs / 1000).toFixed(1)}s`);
  console.log(`  Resolution: ${viewportWidth}x${outputHeight} @ ${opts.fps}fps`);
  console.log(`\nOpen with: open '${outputFile}'`);
}

main().catch((err) => {
  console.error('\nFATAL:', err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
