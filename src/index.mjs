#!/usr/bin/env node
import { loadScore } from './load-score.mjs';
import { renderStrip, NOTATION_ALIASES, STYLE_PRESETS } from './render-strip.mjs';
import { buildTimingMap } from './build-timing.mjs';
import { generateFrames } from './generate-frames.mjs';
import { createEncoder } from './encode-video.mjs';
import { detectTuning } from './tuning.mjs';
import { probeAudio } from './probe-audio.mjs';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

// --- Platform presets ---
// Sources:
//   YouTube: https://support.google.com/youtube/answer/1722171
//   YouTube Shorts: https://vidiq.com/blog/post/youtube-shorts-vertical-video/
//   Instagram specs: https://socialrails.com/blog/instagram-video-size-format-specifications-guide
//   Instagram safe zones: https://zeely.ai/blog/master-instagram-safe-zones/
//   Instagram carousel: https://www.overvisual.com/tools/instagram-carousel-size
//   Facebook specs: https://www.aiarty.com/knowledge-base/facebook-video-size.htm
//   Facebook Reels: https://www.aiarty.com/knowledge-base/facebook-reel-size.htm
//   Facebook safe zones: https://sendshort.ai/guides/facebook-reels-size/
//   TikTok specs: https://fliki.ai/blog/tiktok-video-size
//   TikTok safe zones: https://kreatli.com/guides/tiktok-safe-zone
const PLATFORM_PRESETS = {
  // YouTube landscape (16:9) -- standard playthrough format
  youtube: {
    width: 1920,
    fps: 30,
    scale: 1.0,
    cursorWidth: 3,
    // H.264, AAC 384kbps stereo, 48kHz
    videoBitrate: '12M',
    audioBitrate: '384k',
    audioSampleRate: 48000,
    description: 'YouTube 1080p 16:9 (standard playthrough)',
  },
  'youtube-4k': {
    width: 3840,
    fps: 30,
    scale: 1.3,
    cursorWidth: 5,
    videoBitrate: '45M',
    audioBitrate: '384k',
    audioSampleRate: 48000,
    description: 'YouTube 4K 16:9',
  },
  // YouTube Shorts (9:16 vertical) -- 1080x1920, max 3 min
  'youtube-shorts': {
    width: 1080,
    fps: 30,
    scale: 1.3,
    cursorWidth: 3,
    videoBitrate: '8M',
    audioBitrate: '256k',
    audioSampleRate: 48000,
    vertical: true,
    // Safe zone: keep content in central 4:5 area
    safeMarginBottom: 200,  // px from bottom to avoid UI overlap
    description: 'YouTube Shorts 1080x1920 9:16 (max 3 min)',
  },
  // --- Instagram formats ---
  // Reels (9:16 vertical) -- 1080x1920, up to 15 min (updated Oct 2024)
  // IG caps at 1080p. 30fps recommended. Bitrate 4-6 Mbps per IG spec.
  'instagram': {
    width: 1080,
    fps: 30,
    scale: 1.3,
    cursorWidth: 3,
    videoBitrate: '6M',
    audioBitrate: '256k',
    audioSampleRate: 48000,
    vertical: true,
    // Safe zone: 320px from bottom (captions, buttons), 108px from top (profile bar)
    safeMarginBottom: 320,
    safeMarginTop: 108,
    description: 'Instagram Reels 1080x1920 9:16 (up to 15 min)',
  },
  // Stories (9:16 vertical) -- 1080x1920, 60 sec/segment, 24hr lifespan
  // Lower bitrate (3-4 Mbps). Tighter safe zone -- 250px top AND bottom.
  'instagram-story': {
    width: 1080,
    fps: 30,
    scale: 1.3,
    cursorWidth: 3,
    videoBitrate: '4M',
    audioBitrate: '256k',
    audioSampleRate: 48000,
    maxFileSize: '100MB',
    vertical: true,
    // Safe zone: 250px from top (profile bar, close button) and bottom (reply bar, stickers)
    safeMarginBottom: 250,
    safeMarginTop: 250,
    description: 'Instagram Story 1080x1920 9:16 (60s segments, 24hr)',
  },
  // Feed post (4:5 portrait) -- 1080x1350, max 90 sec
  // NOT 9:16. This is what appears in the main feed grid. 4:5 gets max engagement.
  'instagram-feed': {
    width: 1080,
    fps: 30,
    scale: 1.3,
    cursorWidth: 3,
    videoBitrate: '5M',
    audioBitrate: '256k',
    audioSampleRate: 48000,
    maxFileSize: '100MB',
    vertical: true,
    // No major safe zone issues at 4:5, just 50px from edges
    safeMarginBottom: 50,
    safeMarginTop: 50,
    description: 'Instagram Feed 1080x1350 4:5 (max 90s)',
  },
  // Carousel (4:5 portrait) -- same as feed, 60 sec/slide, up to 20 slides
  // All slides MUST share the same aspect ratio.
  'instagram-carousel': {
    width: 1080,
    fps: 30,
    scale: 1.3,
    cursorWidth: 3,
    videoBitrate: '5M',
    audioBitrate: '256k',
    audioSampleRate: 48000,
    vertical: true,
    safeMarginBottom: 50,
    safeMarginTop: 50,
    description: 'Instagram Carousel 1080x1350 4:5 (60s/slide, 20 slides)',
  },
  // --- Facebook formats ---
  // As of June 2025, ALL Facebook videos are Reels. No separate feed video format.
  // Reels (9:16 vertical) -- 1080x1920, no duration cap. 15-30s performs best.
  // Bitrate 5-8 Mbps for 1080p. AAC 128kbps+ (lower floor than IG).
  // CRITICAL: FB bottom safe zone is 35% (~672px) -- much larger than IG (320px).
  'facebook': {
    width: 1080,
    fps: 30,
    scale: 1.3,
    cursorWidth: 3,
    videoBitrate: '8M',
    audioBitrate: '192k',
    audioSampleRate: 48000,
    vertical: true,
    // Safe zone: 14% top (~269px), 35% bottom (~672px), 6% sides (~65px)
    // FB overlays like/comment/share, description, music info at bottom
    safeMarginBottom: 672,
    safeMarginTop: 269,
    description: 'Facebook Reels 1080x1920 9:16 (no duration cap)',
  },
  // Facebook Stories -- 1080x1920, 20 sec/card, 2 min total, splits at 15s
  'facebook-story': {
    width: 1080,
    fps: 30,
    scale: 1.3,
    cursorWidth: 3,
    videoBitrate: '6M',
    audioBitrate: '192k',
    audioSampleRate: 48000,
    vertical: true,
    // Safe zone: 250px top and bottom
    safeMarginBottom: 250,
    safeMarginTop: 250,
    description: 'Facebook Story 1080x1920 9:16 (20s cards, 24hr)',
  },
  // --- TikTok formats ---
  // Video (9:16 vertical) -- 1080x1920, up to 10 min (60 min for uploads).
  // 30fps preferred (60fps supported but heavier compression).
  // No official bitrate spec -- TikTok recompresses everything.
  // File size: 287.6MB iOS, 72MB Android, 500MB via ads/web.
  // Safe zone: 900x1492 centered -- 108px top, 320px bottom, 60px left, 120px right.
  'tiktok': {
    width: 1080,
    fps: 30,
    scale: 1.3,
    cursorWidth: 3,
    videoBitrate: '8M',     // upload high, TikTok recompresses anyway
    audioBitrate: '256k',
    audioSampleRate: 48000,
    vertical: true,
    // Safe zone: 108px top (username/sound), 320px bottom (captions/CTA),
    // 60px left, 120px right (like/comment/share icons)
    safeMarginBottom: 320,
    safeMarginTop: 108,
    description: 'TikTok 1080x1920 9:16 (up to 10 min, 60 min upload)',
  },
};

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
    platform: null,    // platform preset name
    vertical: false,   // 9:16 vertical output
    videoBitrate: null,
    audioBitrate: null,
    audioSampleRate: null,
    safeMarginBottom: 0,
    safeMarginTop: 0,
    style: null,       // style preset name
    hide: [],          // notation elements to hide
    show: [],          // notation elements to show (hide everything else)
    audio: null,       // audio file (WAV/MP3/FLAC) to mux into output
    template: null,    // template (JSON or built-in name) for compositing
    title: null,       // song title for template text layers
    artist: null,      // artist name for template text layers
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
    } else if (a === '--platform' && argv[i + 1]) {
      opts.platform = argv[++i];
    } else if (a === '--vertical') {
      opts.vertical = true;
    } else if (a === '--style' && argv[i + 1]) {
      opts.style = argv[++i];
    } else if (a === '--hide' && argv[i + 1]) {
      opts.hide = argv[++i].split(',').map((s) => s.trim());
    } else if (a === '--show' && argv[i + 1]) {
      opts.show = argv[++i].split(',').map((s) => s.trim());
    } else if (a === '--audio' && argv[i + 1]) {
      opts.audio = argv[++i];
    } else if (a === '--template' && argv[i + 1]) {
      opts.template = argv[++i];
    } else if (a === '--title' && argv[i + 1]) {
      opts.title = argv[++i];
    } else if (a === '--artist' && argv[i + 1]) {
      opts.artist = argv[++i];
    } else if (!a.startsWith('--')) {
      positional.push(a);
    }
  }

  opts.gpFile = positional[0];
  if (positional[1] && /^\d+(,\d+)*$/.test(positional[1])) {
    opts.tracks = positional[1].split(',').map((t) => parseInt(t, 10));
    if (positional[2]) opts.output = positional[2];
  } else if (positional[1]) {
    // Not a track number -- treat as output file
    opts.output = positional[1];
  }

  // Apply platform preset (CLI flags override preset values)
  if (opts.platform) {
    const preset = PLATFORM_PRESETS[opts.platform];
    if (!preset) {
      console.error(`Unknown platform: ${opts.platform}`);
      console.error(`Available: ${Object.keys(PLATFORM_PRESETS).join(', ')}`);
      process.exit(1);
    }
    // Only apply preset values if not explicitly set by CLI flags
    const cliFlags = new Set(argv.filter((a) => a.startsWith('--')).map((a) => a.replace(/^--/, '')));
    if (!cliFlags.has('width')) opts.width = preset.width;
    if (!cliFlags.has('fps')) opts.fps = preset.fps;
    if (!cliFlags.has('scale')) opts.scale = preset.scale;
    if (!cliFlags.has('cursor-width')) opts.cursorWidth = preset.cursorWidth;
    if (preset.vertical && !cliFlags.has('vertical')) opts.vertical = preset.vertical;
    opts.videoBitrate = preset.videoBitrate;
    opts.audioBitrate = preset.audioBitrate;
    opts.audioSampleRate = preset.audioSampleRate;
    opts.safeMarginBottom = preset.safeMarginBottom || 0;
    opts.safeMarginTop = preset.safeMarginTop || 0;
  }

  // Resolve style preset + notation toggles into notationHide array
  opts.notationHide = resolveNotationHide(opts.style, opts.hide, opts.show);

  return opts;
}

function resolveNotationHide(styleName, hideList, showList) {
  const hideSet = new Set();

  // 1. Apply style preset (if any)
  if (styleName) {
    const style = STYLE_PRESETS[styleName];
    if (!style) {
      console.error(`Unknown style: ${styleName}`);
      console.error(`Available: ${Object.keys(STYLE_PRESETS).join(', ')}`);
      process.exit(1);
    }
    for (const alias of style.hide) {
      const element = NOTATION_ALIASES[alias];
      if (element !== undefined) hideSet.add(element);
    }
  }

  // 2. Apply --hide (additive with style)
  for (const alias of hideList) {
    const element = NOTATION_ALIASES[alias];
    if (element === undefined) {
      console.error(`Unknown notation element: ${alias}`);
      console.error(`Available: ${Object.keys(NOTATION_ALIASES).join(', ')}`);
      process.exit(1);
    }
    hideSet.add(element);
  }

  // 3. Apply --show (exclusive mode: hide everything EXCEPT these)
  if (showList.length > 0) {
    // Validate all show aliases first
    for (const alias of showList) {
      if (NOTATION_ALIASES[alias] === undefined) {
        console.error(`Unknown notation element: ${alias}`);
        console.error(`Available: ${Object.keys(NOTATION_ALIASES).join(', ')}`);
        process.exit(1);
      }
    }
    // Get all unique element values
    const allElements = new Set(Object.values(NOTATION_ALIASES));
    const showElements = new Set(showList.map((a) => NOTATION_ALIASES[a]));
    // Hide everything not in the show list
    for (const element of allElements) {
      if (!showElements.has(element)) hideSet.add(element);
    }
  }

  return [...hideSet];
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
  console.error('  --platform NAME   Platform preset (overrides width/fps/scale/bitrate)');
  console.error('  --vertical        9:16 vertical output (auto-set by platform presets)');
  console.error('  --style NAME      Style preset for notation display');
  console.error('  --hide LIST       Hide notation elements (comma-separated)');
  console.error('  --show LIST       Show ONLY these elements (hides everything else)');
  console.error('  --audio FILE      Audio file (WAV/MP3/FLAC) to mux into the output');
  console.error('  --template T      Template for compositing (JSON file or built-in name)');
  console.error('  --title TEXT      Song title (for template text layers)');
  console.error('  --artist TEXT     Artist name (for template text layers)');
  console.error('');
  console.error('Platform Presets:');
  for (const [name, p] of Object.entries(PLATFORM_PRESETS)) {
    console.error(`  ${name.padEnd(18)} ${p.description}`);
  }
  console.error('');
  console.error('Style Presets:');
  for (const [name, s] of Object.entries(STYLE_PRESETS)) {
    console.error(`  ${name.padEnd(18)} ${s.description}`);
  }
  console.error('');
  console.error('Notation Elements (for --hide/--show):');
  const categories = {
    'Metadata': ['title', 'subtitle', 'artist', 'album', 'words', 'music', 'copyright'],
    'Track': ['tuning', 'trackNames', 'chordDiagrams', 'barNumbers'],
    'Techniques': ['palmMute', 'letRing', 'tap', 'harmonics', 'vibrato', 'wideVibrato',
                   'bend', 'whammyBar', 'pickStroke', 'pickSlide', 'trill', 'fingering',
                   'barre', 'rasgueado', 'golpe', 'leftHandTap'],
    'Expression': ['dynamics', 'crescendo', 'fadeIn'],
    'Structure': ['tempo', 'marker', 'text', 'lyrics', 'chordNames', 'fermata',
                  'freeTime', 'tripletFeel', 'alternateEndings', 'repeatCount', 'directions'],
  };
  for (const [cat, aliases] of Object.entries(categories)) {
    console.error(`  ${cat}: ${aliases.join(', ')}`);
  }
  console.error('');
  console.error('Examples:');
  console.error('  node src/index.mjs song.gp                              # 1080p 30fps standalone');
  console.error('  node src/index.mjs song.gp 0 --transparent --fps 60     # 60fps overlay');
  console.error('  node src/index.mjs song.gp 0,1 --width 3840 --fps 60   # 4K multi-track');
  console.error('  node src/index.mjs song.gp 0 --video playthrough.mp4   # Composite');
  console.error('');
  console.error('  # Platform-optimized:');
  console.error('  node src/index.mjs song.gp 0 --platform youtube         # YouTube 1080p');
  console.error('  node src/index.mjs song.gp 0 --platform youtube-4k      # YouTube 4K');
  console.error('  node src/index.mjs song.gp 0 --platform youtube-shorts  # Shorts 9:16');
  console.error('  node src/index.mjs song.gp 0 --platform instagram       # Reels 9:16');
  console.error('');
  console.error('  # Vertical with playthrough footage:');
  console.error('  node src/index.mjs song.gp 0 --platform instagram --video playthrough.mp4');
  console.error('');
  console.error('  # Style presets and notation toggles:');
  console.error('  node src/index.mjs song.gp 0 --style playthrough           # ERRA-style (P.M., bends, harmonics)');
  console.error('  node src/index.mjs song.gp 0 --style clean                 # No metadata clutter');
  console.error('  node src/index.mjs song.gp 0 --style minimal               # Tab numbers only');
  console.error('  node src/index.mjs song.gp 0 --hide tuning,trackNames      # Hide specific elements');
  console.error('  node src/index.mjs song.gp 0 --show palmMute,harmonics     # Show ONLY these');
  process.exit(1);
}

// --template requires transparent .mov as intermediate
if (opts.template) {
  opts.transparent = true;
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

  // Log platform preset if used
  if (opts.platform) {
    const preset = PLATFORM_PRESETS[opts.platform];
    console.log(`Platform: ${opts.platform} -- ${preset.description}`);
    if (opts.vertical) console.log(`  Orientation: vertical (9:16)`);
    if (opts.videoBitrate) console.log(`  Target bitrate: ${opts.videoBitrate} video, ${opts.audioBitrate} audio`);
  }
  if (opts.style) {
    console.log(`Style: ${opts.style} -- ${STYLE_PRESETS[opts.style].description}`);
  }
  if (opts.notationHide.length > 0) {
    console.log(`  Hiding ${opts.notationHide.length} notation element(s)`);
  }

  console.log(`Loading ${path.basename(opts.gpFile)}...`);
  const { score, settings } = await loadScore(opts.gpFile);
  console.log(`  Title: ${score.title || '(untitled)'}`);
  console.log(
    `  Tracks: ${score.tracks.map((t, i) => `[${i}] ${t.name}`).join(', ')}`
  );
  console.log(`  Tempo: ${score.tempo} BPM`);
  console.log(`  Bars: ${score.masterBars.length}`);

  // Display tuning info for selected tracks
  for (const t of opts.tracks) {
    const track = score.tracks[t];
    const staff = track.staves[0];
    const tunings = staff?.stringTuning?.tunings || [];
    if (tunings.length > 0) {
      const { name, notes } = detectTuning(tunings, tunings.length);
      console.log(`  Track ${t} tuning: ${name} (${notes})`);
    }
  }

  for (const t of opts.tracks) {
    if (t >= score.tracks.length) {
      console.error(`\nError: Track ${t} does not exist. Available: 0-${score.tracks.length - 1}`);
      process.exit(1);
    }
  }

  // Render each track as a strip
  const multiTrack = opts.tracks.length > 1;
  const strips = [];
  for (let ti = 0; ti < opts.tracks.length; ti++) {
    const trackIdx = opts.tracks[ti];
    const mode = opts.transparent ? 'transparent' : 'dark bg';
    const colorLabel = multiTrack ? ` [color ${ti}]` : '';
    console.log(`\nRendering track ${trackIdx}: ${score.tracks[trackIdx].name} [${mode}]${colorLabel}...`);

    // Clone settings for each track render (avoid mutation)
    const { settings: freshSettings } = await loadScore(opts.gpFile);
    const { pngBuffer, boundsLookup, totalWidth, totalHeight } = await renderStrip(
      score,
      freshSettings,
      trackIdx,
      {
        transparent: opts.transparent,
        scale: opts.scale,
        trackColorIndex: multiTrack ? ti : 0,
        notationHide: opts.notationHide,
      }
    );
    console.log(`  Strip size: ${totalWidth}x${totalHeight}px`);

    const { beatTimings, songDurationMs, sectionMarkers } = buildTimingMap(score, boundsLookup, trackIdx);
    console.log(`  Beats mapped: ${beatTimings.length}`);
    console.log(`  Song duration: ${(songDurationMs / 1000).toFixed(1)}s`);
    if (sectionMarkers && sectionMarkers.length > 0) {
      console.log(`  Section markers: ${sectionMarkers.length} (${sectionMarkers.map(m => m.text).join(', ')})`);
    }

    strips.push({ trackIdx, pngBuffer, totalWidth, totalHeight, beatTimings, songDurationMs, sectionMarkers });
  }

  // Use the longest duration across tracks
  const songDurationMs = Math.max(...strips.map((s) => s.songDurationMs));

  // Validate audio file if provided
  let audioFile = null;
  if (opts.audio) {
    audioFile = path.resolve(opts.audio);
    const info = probeAudio(audioFile);
    const songSec = songDurationMs / 1000;
    const diff = Math.abs(info.duration - songSec);
    console.log(`\nAudio: ${path.basename(opts.audio)}`);
    console.log(`  Duration: ${info.duration.toFixed(1)}s (song: ${songSec.toFixed(1)}s${diff > 0.5 ? `, ${diff > 0 ? '+' : ''}${(info.duration - songSec).toFixed(1)}s` : ''})`);
    console.log(`  Format: ${info.codec}, ${info.sampleRate} Hz, ${info.channelLayout}${info.bitDepth ? `, ${info.bitDepth}-bit` : ''}`);
    if (info.duration < songSec - 5) {
      console.log(`  WARNING: Audio is ${(songSec - info.duration).toFixed(1)}s shorter than video -- last ${(songSec - info.duration).toFixed(1)}s will be silent`);
    }
  }

  // Save debug strips
  await fs.promises.mkdir('output', { recursive: true });
  for (const s of strips) {
    const debugPath = `output/debug_strip_track${s.trackIdx}.png`;
    await fs.promises.writeFile(debugPath, s.pngBuffer);
    console.log(`  Debug strip: ${debugPath}`);
  }

  // For multi-track: stack strips vertically
  const viewportWidth = Math.min(opts.width, strips[0].totalWidth);
  let tabHeight;
  if (strips.length === 1) {
    tabHeight = strips[0].totalHeight;
  } else {
    // Stack with 4px gap between tracks
    const gap = 4;
    tabHeight = strips.reduce((h, s) => h + s.totalHeight, 0) + gap * (strips.length - 1);
  }

  // Output dimensions: for standalone tab renders, use tab height
  // For vertical presets without --video, still render just the tab strip
  const outputHeight = tabHeight;

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
  const platformOpts = {
    videoBitrate: opts.videoBitrate,
    audioBitrate: opts.audioBitrate,
    audioSampleRate: opts.audioSampleRate,
  };
  // Pass audio to encoder for standalone mode (no --video). When --video is used, audio is handled in the composite step.
  const encoderAudio = (audioFile && !compositeAfter) ? audioFile : null;
  const encoder = createEncoder(encoderOutput, viewportWidth, outputHeight, opts.fps, alphaOutput, platformOpts, encoderAudio);

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
        sectionMarkers: s.sectionMarkers || [],
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
        sectionMarkers: s.sectionMarkers || [],
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

    // Build ffmpeg filter based on orientation
    let filterComplex;
    let outputArgs;

    // When --audio is provided, it replaces the footage audio
    const overlayLabel = audioFile ? '[v]' : '';

    if (opts.vertical) {
      // Vertical (9:16): footage fills 1080x1920, tab overlay at bottom above safe zone
      const safeBottom = opts.safeMarginBottom || 200;
      const tabScale = `scale=${viewportWidth}:-1`;
      filterComplex = [
        `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[bg]`,
        `[1:v]${tabScale}[tab]`,
        `[bg][tab]overlay=0:H-h-${safeBottom}${overlayLabel}`,
      ].join(';');
      outputArgs = [
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        ...(opts.videoBitrate
          ? ['-b:v', opts.videoBitrate, '-maxrate', opts.videoBitrate, '-bufsize', opts.videoBitrate]
          : ['-crf', '18']),
        '-c:a', 'aac',
        ...(opts.audioBitrate ? ['-b:a', opts.audioBitrate] : ['-b:a', '256k']),
        '-ar', String(opts.audioSampleRate || 48000),
      ];
    } else {
      // Horizontal (16:9): tab at bottom 25% of frame
      filterComplex = `[1:v]scale=-1:ih*0.25[tab];[0:v][tab]overlay=0:H-h-20${overlayLabel}`;
      outputArgs = [
        '-c:v', 'libx264',
        ...(opts.videoBitrate
          ? ['-b:v', opts.videoBitrate, '-maxrate', opts.videoBitrate, '-bufsize', opts.videoBitrate]
          : ['-crf', '18']),
        '-c:a', 'aac',
        ...(opts.audioBitrate ? ['-b:a', opts.audioBitrate] : ['-b:a', '384k']),
        '-ar', String(opts.audioSampleRate || 48000),
      ];
    }

    const ffmpegArgs = [
      '-y',
      '-i', opts.video,
      '-i', encoderOutput,
      ...(audioFile ? ['-i', audioFile] : []),
      '-filter_complex', filterComplex,
      ...(audioFile ? ['-map', '[v]', '-map', '2:a'] : []),
      ...outputArgs,
      '-shortest',
      outputFile,
    ];

    console.log(`  Filter: ${filterComplex}`);
    const ffmpegCmd = ['/opt/homebrew/bin/ffmpeg', ...ffmpegArgs].map((a) => `"${a}"`).join(' ');
    execSync(ffmpegCmd, { stdio: 'inherit' });

    // Clean up temp tab-only file
    await fs.promises.unlink(encoderOutput).catch(() => {});
  }

  // Chain template compositing if --template provided
  let finalOutput = outputFile;
  if (opts.template && !opts.video) {
    const compOutput = outputFile.replace(/\.\w+$/, '_comp.mp4');
    console.log(`\nCompositing with template...`);
    const { execSync: execSyncComp } = await import('child_process');
    const compScript = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'ae-render.mjs');
    const compCmd = [
      'node', compScript,
      outputFile,
      '--template', opts.template,
      '--output', compOutput,
      ...(opts.title ? ['--title', opts.title] : []),
      ...(opts.artist ? ['--artist', opts.artist] : []),
    ].map((a) => `"${a}"`).join(' ');
    execSyncComp(compCmd, { stdio: 'inherit', timeout: 300000 });
    finalOutput = compOutput;
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const orientation = opts.vertical ? '9:16 vertical' : '16:9 horizontal';
  console.log(`\nDone in ${elapsed}s!`);
  console.log(`  Output: ${finalOutput}`);
  console.log(`  Frames: ${frameCount}`);
  console.log(`  Duration: ${(songDurationMs / 1000).toFixed(1)}s`);
  console.log(`  Resolution: ${viewportWidth}x${outputHeight} @ ${opts.fps}fps (${orientation})`);
  if (opts.platform) console.log(`  Platform: ${opts.platform}`);
  if (opts.template) console.log(`  Template: ${opts.template}`);
  console.log(`\nOpen with: open '${finalOutput}'`);
}

main().catch((err) => {
  console.error('\nFATAL:', err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
