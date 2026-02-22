/**
 * Template Compositor -- ffmpeg-native template rendering
 *
 * Composites a transparent tab overlay .mov onto a designed template
 * with background (video/image/gradient), text overlays, and effects.
 * No After Effects required -- pure ffmpeg filter graphs.
 *
 * Usage:
 *   node src/compositor.mjs <tab.mov> --template <template.json> [--output final.mp4]
 *
 * Template JSON format:
 *   {
 *     "width": 1920, "height": 1080,
 *     "background": { "type": "video|image|gradient|solid", ... },
 *     "text": [ { "content": "Song Title", "x": 960, "y": 80, ... } ],
 *     "tab": { "y": "bottom", "scale": 1.0, "padding": 20 },
 *     "effects": { "vignette": true, "darken": 0.3 }
 *   }
 */

import { execFileSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const FFMPEG = '/opt/homebrew/bin/ffmpeg';
const FFPROBE = '/opt/homebrew/bin/ffprobe';

/**
 * Run ffmpeg with given args, streaming progress to stdout.
 */
function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stderrData = '';
    proc.stderr.on('data', (chunk) => {
      stderrData += chunk.toString();
      const match = chunk.toString().match(/frame=\s*(\d+)/);
      if (match) {
        process.stdout.write(`\r  Frame ${match[1]}...`);
      }
    });
    proc.on('close', (code) => {
      console.log('');
      if (code !== 0) {
        reject(new Error(`ffmpeg exited with code ${code}\n${stderrData.slice(-500)}`));
      } else {
        resolve();
      }
    });
    proc.on('error', reject);
  });
}

/**
 * Probe a video/image file for dimensions, fps, and duration.
 */
function probeVideo(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  let result;
  try {
    const raw = execFileSync(FFPROBE, ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath], { encoding: 'utf8' });
    result = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Failed to probe file: ${e.message}`);
  }

  const videoStream = result.streams.find((s) => s.codec_type === 'video');
  if (!videoStream) {
    throw new Error(`No video stream found in ${filePath}`);
  }

  let fps = 30;
  if (videoStream.r_frame_rate) {
    const parts = videoStream.r_frame_rate.split('/');
    fps = parts.length === 2 ? parseInt(parts[0], 10) / parseInt(parts[1], 10) : parseFloat(parts[0]);
  }

  return {
    width: videoStream.width,
    height: videoStream.height,
    fps: Math.round(fps),
    duration: parseFloat(result.format.duration || '0'),
    codec: videoStream.codec_name,
  };
}

/**
 * Escape text for ffmpeg drawtext filter.
 */
function escapeDrawtext(text) {
  // Order matters: escape backslashes first, then special chars
  return text.replace(/\\/g, '\\\\').replace(/'/g, "'\\\\\\''").replace(/:/g, '\\:');
}

/**
 * Build the ffmpeg filter graph from a template config.
 *
 * Input 0: background (video/image/color)
 * Input 1: tab overlay .mov (with alpha)
 * Input 2: watermark image (optional, when watermarkConfig provided)
 */
function buildFilterGraph(template, tabProbe, watermarkConfig) {
  const W = template.width || tabProbe.width;
  const H = template.height || tabProbe.height;
  const filters = [];

  // --- Background preparation ---
  const bg = template.background || {};
  if (bg.type === 'video' || bg.type === 'image') {
    // Scale and crop to fill frame
    filters.push(`[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}[bg0]`);
  } else {
    // Solid color or gradient already generated as input
    filters.push(`[0:v]scale=${W}:${H}[bg0]`);
  }

  // --- Background effects ---
  const fx = template.effects || {};
  let bgLabel = 'bg0';

  if (fx.darken) {
    const brightness = -Math.abs(fx.darken);
    filters.push(`[${bgLabel}]eq=brightness=${brightness}:contrast=1.1:saturation=0.5[bg1]`);
    bgLabel = 'bg1';
  }

  if (fx.colorTint) {
    const tint = fx.colorTint;
    filters.push(`[${bgLabel}]colorbalance=bs=${tint.blue || 0}:bm=${tint.blue ? tint.blue * 0.5 : 0}:rs=${tint.red || 0}:gs=${tint.green || 0}[bg2]`);
    bgLabel = 'bg2';
  }

  if (fx.vignette) {
    filters.push(`[${bgLabel}]vignette=PI/2.5:1.2[bg3]`);
    bgLabel = 'bg3';
  }

  // --- Text overlays ---
  const textLayers = template.text || [];
  for (let i = 0; i < textLayers.length; i++) {
    const t = textLayers[i];
    const fontSize = t.fontSize || 48;
    const fontColor = t.color || 'white';
    const font = t.font || '';
    const x = t.x === 'center' ? '(w-text_w)/2' : String(t.x || 100);
    const y = String(t.y || 80);
    const alpha = t.alpha !== undefined ? t.alpha : 1.0;

    let drawtext = `drawtext=text='${escapeDrawtext(t.content || '')}':fontsize=${fontSize}:fontcolor=${fontColor}@${alpha}:x=${x}:y=${y}`;
    if (font) drawtext += `:fontfile=${font}`;
    if (t.shadowColor) drawtext += `:shadowcolor=${t.shadowColor}:shadowx=2:shadowy=2`;

    const nextLabel = `txt${i}`;
    filters.push(`[${bgLabel}]${drawtext}[${nextLabel}]`);
    bgLabel = nextLabel;
  }

  // --- Tab overlay positioning ---
  const tab = template.tab || {};
  const tabScale = tab.scale || 1.0;
  const tabPad = tab.padding || 20;

  // Scale tab if needed
  if (tabScale !== 1.0) {
    filters.push(`[1:v]scale=iw*${tabScale}:-1[tabscaled]`);
  }
  const tabLabel = tabScale !== 1.0 ? 'tabscaled' : '1:v';

  // Position: default bottom
  let tabY;
  if (tab.y === 'center') {
    tabY = '(H-h)/2';
  } else if (tab.y === 'top') {
    tabY = String(tabPad);
  } else if (typeof tab.y === 'number') {
    tabY = String(tab.y);
  } else {
    // bottom (default)
    tabY = `H-h-${tabPad}`;
  }
  const tabX = tab.x === 'center' ? '(W-w)/2' : String(tab.x || 0);

  // Dark band behind tab for readability (optional)
  if (tab.darkBand !== false) {
    const tabH = Math.round(tabProbe.height * tabScale);
    const bandHeight = tabH + tabPad * 2;
    const bandY = `${tabY}-${tabPad}`;
    filters.push(`color=black@0.6:${W}x${bandHeight}[band]`);
    filters.push(`[${bgLabel}][band]overlay=0:${bandY}[withband]`);
    bgLabel = 'withband';
  }

  // Overlay tab
  if (watermarkConfig) {
    filters.push(`[${bgLabel}][${tabLabel}]overlay=${tabX}:${tabY}:format=auto[withtab]`);
    bgLabel = 'withtab';
  } else {
    filters.push(`[${bgLabel}][${tabLabel}]overlay=${tabX}:${tabY}:format=auto`);
  }

  // --- Watermark overlay (optional) ---
  if (watermarkConfig) {
    const wm = watermarkConfig;
    const wmScale = wm.scale || 0.12;
    const wmOpacity = wm.opacity || 0.3;
    const wmMargin = wm.margin || 20;
    const wmPos = wm.position || 'bottom-right';
    const wmW = Math.round(W * wmScale);

    // Scale watermark and set opacity
    filters.push(`[2:v]scale=${wmW}:-1,format=rgba,colorchannelmixer=aa=${wmOpacity}[wm]`);

    // Position based on corner
    let wmX, wmY;
    if (wmPos === 'top-left') { wmX = String(wmMargin); wmY = String(wmMargin); }
    else if (wmPos === 'top-right') { wmX = `W-w-${wmMargin}`; wmY = String(wmMargin); }
    else if (wmPos === 'bottom-left') { wmX = String(wmMargin); wmY = `H-h-${wmMargin}`; }
    else { wmX = `W-w-${wmMargin}`; wmY = `H-h-${wmMargin}`; } // bottom-right default

    filters.push(`[${bgLabel}][wm]overlay=${wmX}:${wmY}`);
  }

  return filters.join(';');
}

function parseArgs(argv) {
  const opts = {
    input: null,
    template: null,
    output: null,
    title: null,
    artist: null,
    watermark: null,
    intro: false,
  };

  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if ((a === '--template' || a === '-t') && argv[i + 1]) {
      opts.template = argv[++i];
    } else if ((a === '--output' || a === '-o') && argv[i + 1]) {
      opts.output = argv[++i];
    } else if (a === '--title' && argv[i + 1]) {
      opts.title = argv[++i];
    } else if (a === '--artist' && argv[i + 1]) {
      opts.artist = argv[++i];
    } else if ((a === '--watermark' || a === '-w') && argv[i + 1]) {
      opts.watermark = argv[++i];
    } else if (a === '--intro') {
      opts.intro = true;
    } else if (a.startsWith('-')) {
      console.error(`Unknown option: ${a}`);
      process.exit(1);
    } else {
      positional.push(a);
    }
  }

  opts.input = positional[0];
  return opts;
}

/**
 * Built-in templates when no JSON file is provided.
 */
const BUILT_IN_TEMPLATES = {
  cinematic: {
    width: 1920,
    height: 1080,
    background: { type: 'solid', color: '0x0A0A12' },
    text: [],
    tab: { y: 'bottom', padding: 40, darkBand: false },
    effects: { vignette: true },
  },
  'cinematic-title': {
    width: 1920,
    height: 1080,
    background: { type: 'solid', color: '0x0A0A12' },
    text: [
      { content: '{title}', x: 'center', y: 80, fontSize: 64, color: 'white', shadowColor: 'black@0.5' },
      { content: '{artist}', x: 'center', y: 160, fontSize: 36, color: 'gray', alpha: 0.7 },
    ],
    tab: { y: 'bottom', padding: 40, darkBand: false },
    effects: { vignette: true },
  },
  'dark-overlay': {
    width: 1920,
    height: 1080,
    background: { type: 'video' },
    text: [],
    tab: { y: 'bottom', padding: 30, darkBand: true },
    effects: { darken: 0.35, colorTint: { blue: 0.15 }, vignette: true },
  },
  'reel': {
    width: 1080,
    height: 1920,
    background: { type: 'video' },
    text: [],
    tab: { y: 'bottom', scale: 0.5625, padding: 30, darkBand: true },
    effects: { darken: 0.15, vignette: true },
  },
  'reel-title': {
    width: 1080,
    height: 1920,
    background: { type: 'video' },
    text: [
      { content: '{title}', x: 'center', y: 1640, fontSize: 44, color: 'white', shadowColor: 'black@0.8' },
      { content: '{artist}', x: 'center', y: 1695, fontSize: 26, color: 'gray', alpha: 0.7 },
    ],
    tab: { y: 'bottom', scale: 0.5625, padding: 30, darkBand: true },
    effects: { darken: 0.15, vignette: true },
  },
};

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!opts.input) {
    console.error('Usage: node src/compositor.mjs <tab.mov> [--template <file.json|name>] [--output final.mp4]');
    console.error('');
    console.error('Options:');
    console.error('  -t, --template FILE   Template JSON file or built-in name');
    console.error('  -o, --output FILE     Output file (default: <input>_comp.mp4)');
    console.error('  --title TEXT          Song title (replaces {title} in template)');
    console.error('  --artist TEXT         Artist name (replaces {artist} in template)');
    console.error('  -w, --watermark FILE  Watermark image (PNG with transparency)');
    console.error('  --intro               Add logo intro sequence (requires --watermark)');
    console.error('');
    console.error('Built-in templates:');
    console.error('  cinematic         Dark background + vignette (1920x1080)');
    console.error('  cinematic-title   Dark bg + song title + artist (1920x1080)');
    console.error('  dark-overlay      Video bg + cinematic grading + dark band (1920x1080)');
    console.error('  reel              Portrait video bg for IG/TikTok (1080x1920)');
    console.error('  reel-title        Portrait + song title + artist (1080x1920)');
    console.error('');
    console.error('Template JSON format:');
    console.error('  { "width": 1920, "height": 1080,');
    console.error('    "background": { "type": "video|image|solid", "source": "bg.mp4", "color": "0x0A0A12" },');
    console.error('    "text": [{ "content": "Title", "x": "center", "y": 80, "fontSize": 64, "color": "white" }],');
    console.error('    "tab": { "y": "bottom", "padding": 20, "scale": 1.0, "darkBand": true },');
    console.error('    "effects": { "vignette": true, "darken": 0.3, "colorTint": { "blue": 0.15 } } }');
    process.exit(1);
  }

  const inputPath = path.resolve(opts.input);
  const outputPath = opts.output
    ? path.resolve(opts.output)
    : inputPath.replace(/\.\w+$/, '_comp.mp4');

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  // Load template
  let template;
  if (!opts.template) {
    template = { ...BUILT_IN_TEMPLATES['cinematic'] };
  } else if (BUILT_IN_TEMPLATES[opts.template]) {
    template = JSON.parse(JSON.stringify(BUILT_IN_TEMPLATES[opts.template]));
  } else {
    const tplPath = path.resolve(opts.template);
    if (!fs.existsSync(tplPath)) {
      throw new Error(`Template not found: ${tplPath}`);
    }
    template = JSON.parse(fs.readFileSync(tplPath, 'utf8'));
  }

  // Replace {title} and {artist} placeholders in text layers
  if (template.text) {
    for (const t of template.text) {
      if (t.content) {
        t.content = t.content.replace('{title}', opts.title || 'Untitled');
        t.content = t.content.replace('{artist}', opts.artist || '');
      }
    }
  }

  // Probe input
  console.log(`\nProbing ${path.basename(inputPath)}...`);
  const tabProbe = probeVideo(inputPath);
  console.log(`  ${tabProbe.width}x${tabProbe.height} @ ${tabProbe.fps}fps, ${tabProbe.duration.toFixed(1)}s`);

  // Build background input
  const bg = template.background || {};
  let bgInput;
  let bgInputArgs;

  if (bg.type === 'video' && bg.source) {
    const bgPath = path.resolve(path.dirname(opts.template || '.'), bg.source);
    if (!fs.existsSync(bgPath)) {
      throw new Error(`Background video not found: ${bgPath}`);
    }
    bgInputArgs = ['-stream_loop', '-1', '-t', String(tabProbe.duration), '-r', String(tabProbe.fps), '-i', bgPath];
    bgInput = 'video';
  } else if (bg.type === 'image' && bg.source) {
    const bgPath = path.resolve(path.dirname(opts.template || '.'), bg.source);
    if (!fs.existsSync(bgPath)) {
      throw new Error(`Background image not found: ${bgPath}`);
    }
    bgInputArgs = ['-loop', '1', '-t', String(tabProbe.duration), '-i', bgPath];
    bgInput = 'image';
  } else {
    // Solid color
    const color = bg.color || '0x0A0A12';
    const W = template.width || tabProbe.width;
    const H = template.height || tabProbe.height;
    bgInputArgs = ['-f', 'lavfi', '-t', String(tabProbe.duration), '-i', `color=c=${color}:s=${W}x${H}:r=${tabProbe.fps}`];
    bgInput = 'solid';
  }

  // --- Watermark setup ---
  let watermarkConfig = null;
  let watermarkInputArgs = [];
  if (opts.watermark) {
    const wmPath = path.resolve(opts.watermark);
    if (!fs.existsSync(wmPath)) {
      throw new Error(`Watermark image not found: ${wmPath}`);
    }
    watermarkConfig = {
      position: (template.watermark && template.watermark.position) || 'bottom-right',
      scale: (template.watermark && template.watermark.scale) || 0.12,
      opacity: (template.watermark && template.watermark.opacity) || 0.3,
      margin: (template.watermark && template.watermark.margin) || 20,
    };
    watermarkInputArgs = ['-i', wmPath];
    console.log(`  Watermark: ${path.basename(wmPath)} (${watermarkConfig.position}, ${Math.round(watermarkConfig.opacity * 100)}% opacity)`);
  }

  if (opts.intro && !opts.watermark) {
    throw new Error('--intro requires --watermark (the watermark image is used as the intro logo)');
  }

  // Determine output paths
  const mainOutputPath = opts.intro
    ? outputPath.replace(/(\.\w+)$/, '_main$1')
    : outputPath;

  // Build filter graph
  const filterComplex = buildFilterGraph(template, tabProbe, watermarkConfig);
  console.log(`\nCompositing with template...`);
  console.log(`  Background: ${bgInput}`);
  console.log(`  Filter: ${filterComplex.substring(0, 120)}...`);

  // Build ffmpeg command
  const ffmpegArgs = [
    '-y',
    ...bgInputArgs,
    '-i', inputPath,
    ...watermarkInputArgs,
    '-filter_complex', filterComplex,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-crf', '18',
    '-r', String(tabProbe.fps),
    '-t', String(tabProbe.duration),
    mainOutputPath,
  ];

  await runFfmpeg(ffmpegArgs);

  // --- Intro generation (optional) ---
  if (opts.intro) {
    console.log(`\nGenerating intro sequence...`);
    const W = template.width || tabProbe.width;
    const H = template.height || tabProbe.height;
    const intro = template.intro || {};
    const introDur = intro.duration || 3;
    const fadeIn = intro.fadeIn || 1;
    const fadeOut = intro.fadeOut || 1;
    const introScale = intro.scale || 0.4;
    const introBg = intro.background || '0x000000';
    const logoW = Math.round(W * introScale);
    const wmPath = path.resolve(opts.watermark);

    // Build intro + concat filter graph
    const introFilter = [
      // Scale logo for intro (centered)
      `[1:v]scale=${logoW}:-1,format=rgba[logo]`,
      // Overlay logo centered on black background
      `[0:v][logo]overlay=(W-w)/2:(H-h)/2[intro_raw]`,
      // Fade in and out
      `[intro_raw]fade=t=in:st=0:d=${fadeIn},fade=t=out:st=${introDur - fadeOut}:d=${fadeOut}[intro]`,
      // Concat intro with main video
      `[intro][2:v]concat=n=2:v=1:a=0[out]`,
    ].join(';');

    const introArgs = [
      '-y',
      // Input 0: black background for intro
      '-f', 'lavfi', '-t', String(introDur), '-i', `color=c=${introBg}:s=${W}x${H}:r=${tabProbe.fps}`,
      // Input 1: logo image
      '-loop', '1', '-t', String(introDur), '-i', wmPath,
      // Input 2: main composite
      '-i', mainOutputPath,
      '-filter_complex', introFilter,
      '-map', '[out]',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-crf', '18',
      '-r', String(tabProbe.fps),
      outputPath,
    ];

    try {
      await runFfmpeg(introArgs);
    } finally {
      // Clean up temp main composite
      try { fs.unlinkSync(mainOutputPath); } catch (_) { /* ignore */ }
    }
  }

  console.log(`\nDone!`);
  console.log(`  Output: ${outputPath}`);
  console.log(`\nOpen with: open '${outputPath}'`);
}

main().catch((err) => {
  console.error('\nFATAL:', err.message);
  process.exit(1);
});
