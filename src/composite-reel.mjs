#!/usr/bin/env node
/**
 * Composite pipeline: background video/animation + tab overlay -> social media video.
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
 *   --bg FILE         Background video file (.mp4/.mov) or "neon-guitar" for built-in animation
 *   --audio FILE      Audio file (WAV/MP3) to mux into output
 *   --output FILE     Output file path
 */
import { spawn, execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import sharp from 'sharp';
import { loadScore } from './load-score.mjs';
import { renderStrip, STYLE_PRESETS } from './render-strip.mjs';
import { buildTimingMap } from './build-timing.mjs';
import { generateFrames } from './generate-frames.mjs';
import { detectTuning } from './tuning.mjs';
import { probeAudio } from './probe-audio.mjs';
import { createNeonRenderer } from './neon-guitar-bg.mjs';

const FFMPEG = '/opt/homebrew/bin/ffmpeg';
const FFPROBE = '/opt/homebrew/bin/ffprobe';

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
    bg: null,
    audio: null,
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
    else if (a === '--audio' && argv[i+1]) opts.audio = argv[++i];
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
  console.error('  --bg FILE          Background video (.mp4/.mov) or "neon-guitar"');
  console.error('  --audio FILE       Audio file (WAV/MP3/FLAC) to mux into output');
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

// Determine background type: built-in animation or video file
const isVideoBg = opts.bg && opts.bg !== 'neon-guitar' && fs.existsSync(opts.bg);
if (opts.bg && opts.bg !== 'neon-guitar' && !isVideoBg) {
  console.error(`Background file not found: ${opts.bg}`);
  console.error('Use --bg <video-file> or --bg neon-guitar');
  process.exit(1);
}

async function main() {
  const startTime = Date.now();
  console.log(`Composite reel: ${basename}`);
  console.log(`  Platform: ${opts.platform} (${platform.label})`);
  console.log(`  Resolution: ${W}x${H} @ ${fps}fps`);
  console.log(`  Duration: ${opts.duration}s (${totalFrames} frames)`);
  console.log(`  Background: ${isVideoBg ? path.basename(opts.bg) : (opts.bg || 'neon-guitar')}`);
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

  // Validate audio file if provided
  let audioFile = null;
  if (opts.audio) {
    audioFile = path.resolve(opts.audio);
    const info = probeAudio(audioFile);
    const neededEnd = startOffsetMs / 1000 + opts.duration;
    console.log(`\n  Audio: ${path.basename(opts.audio)}`);
    console.log(`    Duration: ${info.duration.toFixed(1)}s | Format: ${info.codec}, ${info.sampleRate} Hz, ${info.channelLayout}`);
    console.log(`    Reel window: ${(startOffsetMs / 1000).toFixed(1)}s - ${neededEnd.toFixed(1)}s`);
    if (info.duration < neededEnd) {
      console.error(`\n  ERROR: Audio is ${info.duration.toFixed(1)}s but reel needs audio up to ${neededEnd.toFixed(1)}s`);
      process.exit(1);
    }
  }

  // Shift beat timings so startOffsetMs maps to time 0
  for (const s of strips) {
    for (const bt of s.beatTimings) {
      bt.ms -= startOffsetMs;
    }
  }

  // 5. Tab viewport dimensions
  const tabViewportWidth = W;
  const tabHeight = strips.length === 1
    ? strips[0].totalHeight
    : strips.reduce((h, s) => h + s.totalHeight, 0) + 4 * (strips.length - 1);

  // Tab vertical position: center vertically, but bias toward lower third for social safe zone
  const tabY = Math.round(H * 0.55 - tabHeight / 2);

  console.log(`  Tab viewport: ${tabViewportWidth}x${tabHeight}px at y=${tabY}`);

  await fs.promises.mkdir(path.dirname(outputFile), { recursive: true });

  if (isVideoBg) {
    // ===== VIDEO FILE BACKGROUND =====
    // ffmpeg reads the video directly -- no Canvas rendering needed.
    // Pipeline: ffmpeg reads bg video + tab overlay pipe, composites with cinematic grading.
    await renderWithVideoBg(strips, songDurationMs, startOffsetMs, tabViewportWidth, tabHeight, tabY, audioFile);
  } else {
    // ===== NEON GUITAR ANIMATION BACKGROUND =====
    // Canvas 2D renders frames piped to ffmpeg alongside tab overlay pipe.
    await renderWithAnimationBg(strips, songDurationMs, startOffsetMs, tabViewportWidth, tabHeight, tabY, audioFile);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n\nDone in ${elapsed}s!`);
  console.log(`  Output: ${outputFile}`);
  console.log(`  ${W}x${H} @ ${fps}fps, ${opts.duration}s`);
  console.log(`  Platform: ${platform.label}`);
  console.log(`\nOpen with: open '${outputFile}'`);
}

/**
 * Render with a video file as background.
 * ffmpeg reads the video file directly, applies cinematic grading, and overlays the tab.
 * Tab frames are piped on stdin. Much faster than Canvas rendering.
 */
async function renderWithVideoBg(strips, songDurationMs, startOffsetMs, tabViewportWidth, tabHeight, tabY, audioFile) {
  console.log('\nCompositing with video background...');
  const bgFile = path.resolve(opts.bg);
  const startSec = startOffsetMs / 1000;

  // Audio args
  const audioInputArgs = audioFile ? [
    '-ss', String(startSec),
    '-t', String(opts.duration),
    '-i', audioFile,
  ] : [];
  const audioEncArgs = audioFile
    ? ['-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-shortest']
    : ['-an'];

  // Input 0: background video (seeked to start offset, trimmed to duration)
  // Input 1: tab overlay (raw RGBA on stdin)
  // Input 2 (optional): audio file
  //
  // Filter: scale bg to fill frame, crop to exact dimensions, apply cinematic grade,
  //         add dark band behind tab for readability, overlay tab.
  const filter = [
    // Scale bg video to fill target frame, crop to exact size
    `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},` +
    // Cinematic grading: darken, desaturate, blue tint, vignette
    `eq=brightness=-0.35:contrast=1.2:saturation=0.4,` +
    `colorbalance=bs=0.15:bm=0.08,` +
    `vignette=PI/2.5:1.2[bg]`,
    // Dark band behind tab area for readability
    `color=black@0.65:${W}x${tabHeight + 80}[band]`,
    `[band]gblur=sigma=30[blurband]`,
    `[bg][blurband]overlay=0:${tabY - 40}[graded]`,
    // Overlay tab
    `[graded][1:v]overlay=0:${tabY}:format=auto`,
  ].join(';');

  const ffmpeg = spawn(FFMPEG, [
    '-y',
    // Input 0: background video (loop if shorter than duration, play from start)
    '-stream_loop', '-1', '-t', String(opts.duration),
    '-i', bgFile,
    // Input 1: tab overlay (raw RGBA on stdin)
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${tabViewportWidth}x${tabHeight}`, '-r', String(fps), '-i', 'pipe:0',
    // Input 2: audio (optional)
    ...audioInputArgs,
    '-filter_complex', filter,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-b:v', bitrate, '-maxrate', bitrate, '-bufsize', bitrate,
    '-preset', 'medium', '-movflags', '+faststart',
    ...audioEncArgs,
    outputFile,
  ], {
    stdio: ['pipe', 'inherit', 'inherit'],
  });

  const writeTab = (buf) => new Promise((resolve) => {
    if (!ffmpeg.stdin.write(buf)) ffmpeg.stdin.once('drain', resolve);
    else resolve();
  });

  // Generate and pipe tab frames
  console.log(`\nRendering ${totalFrames} frames...`);
  await pipeTabFrames(strips, songDurationMs, tabViewportWidth, tabHeight, writeTab);

  ffmpeg.stdin.end();
  await new Promise((resolve) => { ffmpeg.on('close', resolve); });
}

/**
 * Render with the built-in neon guitar Canvas 2D animation.
 * Two raw video pipes to ffmpeg: bg on pipe:3, tab on pipe:4.
 */
async function renderWithAnimationBg(strips, songDurationMs, startOffsetMs, tabViewportWidth, tabHeight, tabY, audioFile) {
  console.log('\nInitializing neon guitar animation...');
  const bgScale = 2;
  const bgW = Math.round(W / bgScale);
  const bgH = Math.round(H / bgScale);
  const bgRenderer = createNeonRenderer(bgW, bgH, fps);

  const startSec = startOffsetMs / 1000;

  // Audio args
  const audioArgs = audioFile ? [
    '-ss', String(startSec),
    '-t', String(opts.duration),
    '-i', audioFile,
  ] : [];
  const audioEncArgs = audioFile
    ? ['-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-shortest']
    : ['-an'];

  const ffmpeg = spawn(FFMPEG, [
    '-y',
    // Input 0: background (half res, upscaled by filter)
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${bgW}x${bgH}`, '-r', String(fps), '-i', 'pipe:3',
    // Input 1: tab overlay
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${tabViewportWidth}x${tabHeight}`, '-r', String(fps), '-i', 'pipe:4',
    // Input 2: audio (optional)
    ...audioArgs,
    // Upscale bg to full res, then overlay tab
    '-filter_complex', `[0:v]scale=${W}:${H}:flags=lanczos[bg];[bg][1:v]overlay=0:${tabY}:format=auto`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-b:v', bitrate, '-maxrate', bitrate, '-bufsize', bitrate,
    '-preset', 'medium', '-movflags', '+faststart',
    ...audioEncArgs,
    outputFile,
  ], {
    stdio: ['pipe', 'inherit', 'inherit', 'pipe', 'pipe'],
  });

  const bgPipe = ffmpeg.stdio[3];
  const tabPipe = ffmpeg.stdio[4];

  const writeBg = (buf) => new Promise((resolve) => {
    if (!bgPipe.write(buf)) bgPipe.once('drain', resolve);
    else resolve();
  });
  const writeTab = (buf) => new Promise((resolve) => {
    if (!tabPipe.write(buf)) tabPipe.once('drain', resolve);
    else resolve();
  });

  console.log(`\nRendering ${totalFrames} frames...`);

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
  const multiTrack = strips.length > 1;

  for (let frame = 0; frame < totalFrames; frame++) {
    // Background frame from Canvas 2D
    const bgFrame = bgRenderer.renderFrame();
    await writeBg(bgFrame);

    // Tab frame(s)
    if (!multiTrack) {
      const result = await tabIterators[0].next();
      if (!result.done) await writeTab(Buffer.from(result.value.buffer));
    } else {
      const results = await Promise.all(tabIterators.map(it => it.next()));
      const gap = 4;
      const stackBuf = Buffer.alloc(tabViewportWidth * tabHeight * 4);
      let yOff = 0;
      for (const r of results) {
        if (r.done) continue;
        const { buffer: tbuf, width: tw, height: th } = r.value;
        for (let y = 0; y < th; y++) {
          const srcStart = y * tw * 4;
          const dstStart = (yOff + y) * tabViewportWidth * 4;
          Buffer.from(tbuf).copy(stackBuf, dstStart, srcStart, srcStart + tw * 4);
        }
        yOff += th + gap;
      }
      await writeTab(stackBuf);
    }

    if ((frame + 1) % 30 === 0 || frame === totalFrames - 1) {
      const pct = ((frame + 1) / totalFrames * 100).toFixed(0);
      process.stdout.write(`\r  Frame ${frame + 1}/${totalFrames} (${pct}%)`);
    }
  }

  bgPipe.end();
  tabPipe.end();
  await new Promise((resolve) => { ffmpeg.on('close', resolve); });
}

/**
 * Pipe tab frames to ffmpeg. Used by the video background path
 * where only tab frames need piping (bg is read by ffmpeg directly).
 */
async function pipeTabFrames(strips, songDurationMs, tabViewportWidth, tabHeight, writeTab) {
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
  const multiTrack = strips.length > 1;

  for (let frame = 0; frame < totalFrames; frame++) {
    if (!multiTrack) {
      const result = await tabIterators[0].next();
      if (!result.done) await writeTab(Buffer.from(result.value.buffer));
    } else {
      const results = await Promise.all(tabIterators.map(it => it.next()));
      const gap = 4;
      const stackBuf = Buffer.alloc(tabViewportWidth * tabHeight * 4);
      let yOff = 0;
      for (const r of results) {
        if (r.done) continue;
        const { buffer: tbuf, width: tw, height: th } = r.value;
        for (let y = 0; y < th; y++) {
          const srcStart = y * tw * 4;
          const dstStart = (yOff + y) * tabViewportWidth * 4;
          Buffer.from(tbuf).copy(stackBuf, dstStart, srcStart, srcStart + tw * 4);
        }
        yOff += th + gap;
      }
      await writeTab(stackBuf);
    }

    if ((frame + 1) % 30 === 0 || frame === totalFrames - 1) {
      const pct = ((frame + 1) / totalFrames * 100).toFixed(0);
      process.stdout.write(`\r  Frame ${frame + 1}/${totalFrames} (${pct}%)`);
    }
  }
}

main().catch(err => {
  console.error('\nFATAL:', err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
