import * as alphaTab from '@coderline/alphatab';
import * as alphaSkia from '@coderline/alphaskia';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const Color = alphaTab.model.Color;
const NE = alphaTab.NotationElement;

// Friendly aliases for NotationElement toggles (CLI-facing names -> enum values).
// Grouped by category for --help readability.
export const NOTATION_ALIASES = {
  // Score metadata
  title:          NE.ScoreTitle,
  subtitle:       NE.ScoreSubTitle,
  artist:         NE.ScoreArtist,
  album:          NE.ScoreAlbum,
  words:          NE.ScoreWords,
  music:          NE.ScoreMusic,
  copyright:      NE.ScoreCopyright,
  // Track info
  tuning:         NE.GuitarTuning,
  trackNames:     NE.TrackNames,
  chordDiagrams:  NE.ChordDiagrams,
  barNumbers:     NE.BarNumber,
  // Technique effects
  palmMute:       NE.EffectPalmMute,
  letRing:        NE.EffectLetRing,
  hammerPull:     NE.EffectTap,  // alphaTab groups H/P with tap notation
  tap:            NE.EffectTap,
  harmonics:      NE.EffectHarmonics,
  vibrato:        NE.EffectSlightNoteVibrato,
  wideVibrato:    NE.EffectWideNoteVibrato,
  beatVibrato:    NE.EffectSlightBeatVibrato,
  wideBeatVibrato: NE.EffectWideBeatVibrato,
  bend:           NE.ScoreBendSlur,
  whammyBar:      NE.EffectWhammyBar,
  whammyLine:     NE.EffectWhammyBarLine,
  pickStroke:     NE.EffectPickStroke,
  pickSlide:      NE.EffectPickSlide,
  trill:          NE.EffectTrill,
  fingering:      NE.EffectFingering,
  capo:           NE.EffectCapo,
  barre:          NE.EffectBeatBarre,
  rasgueado:      NE.EffectRasgueado,
  golpe:          NE.EffectGolpe,
  leftHandTap:    NE.EffectLeftHandTap,
  // Dynamics & expression
  dynamics:       NE.EffectDynamics,
  crescendo:      NE.EffectCrescendo,
  fadeIn:         NE.EffectFadeIn,
  // Structure & text
  tempo:          NE.EffectTempo,
  marker:         NE.EffectMarker,
  text:           NE.EffectText,
  lyrics:         NE.EffectLyrics,
  chordNames:     NE.EffectChordNames,
  fermata:        NE.EffectFermata,
  freeTime:       NE.EffectFreeTime,
  tripletFeel:    NE.EffectTripletFeel,
  alternateEndings: NE.EffectAlternateEndings,
  repeatCount:    NE.RepeatCount,
  directions:     NE.EffectDirections,
  // Pedals
  wahPedal:       NE.EffectWahPedal,
  sustainPedal:   NE.EffectSustainPedal,
};

// Style presets: pre-configured combinations of notation toggles and display settings.
// Each style can hide specific elements and override scale/colors.
export const STYLE_PRESETS = {
  // Default: everything visible, standard colors
  default: {
    description: 'All notation elements visible (default)',
    hide: [],
  },
  // Clean: hide metadata clutter, keep all technique annotations
  clean: {
    description: 'Hide metadata (title, tuning, track names), keep techniques',
    hide: ['title', 'subtitle', 'artist', 'album', 'words', 'music', 'copyright',
           'tuning', 'trackNames', 'chordDiagrams', 'tempo', 'tripletFeel'],
  },
  // Minimal: bare tab numbers + staff lines only, hide ALL annotations
  minimal: {
    description: 'Tab numbers and staff lines only, no annotations',
    hide: ['title', 'subtitle', 'artist', 'album', 'words', 'music', 'copyright',
           'tuning', 'trackNames', 'chordDiagrams', 'barNumbers', 'tempo', 'tripletFeel',
           'palmMute', 'letRing', 'tap', 'harmonics', 'vibrato', 'wideVibrato',
           'beatVibrato', 'wideBeatVibrato', 'bend', 'whammyBar', 'whammyLine',
           'pickStroke', 'pickSlide', 'trill', 'fingering', 'capo', 'barre',
           'rasgueado', 'golpe', 'leftHandTap', 'dynamics', 'crescendo', 'fadeIn',
           'marker', 'text', 'lyrics', 'chordNames', 'fermata', 'freeTime',
           'alternateEndings', 'repeatCount', 'directions', 'wahPedal', 'sustainPedal'],
  },
  // Playthrough: optimized for ERRA-style playthrough videos
  // Shows P.M., H/P, slides, bends, harmonics. Hides metadata and less visual elements.
  playthrough: {
    description: 'Optimized for playthrough videos (P.M., H/P, bends, harmonics)',
    hide: ['title', 'subtitle', 'artist', 'album', 'words', 'music', 'copyright',
           'tuning', 'trackNames', 'chordDiagrams', 'tempo', 'tripletFeel',
           'fingering', 'capo', 'lyrics', 'text', 'wahPedal', 'sustainPedal',
           'directions', 'freeTime'],
  },
};

// Pre-defined track color palettes for multi-track rendering.
// Each palette: { main, staffLine, barNumber, secondary, barSep }
// Inspired by ERRA/Jackson Guitars playthrough videos.
const TRACK_PALETTES = [
  // Track 0: White (default -- lead guitar)
  {
    main:      [255, 255, 255],
    staffLine: [180, 180, 180],
    barNumber: [180, 180, 180],
    secondary: [180, 180, 180],
    barSep:    [100, 100, 100],
  },
  // Track 1: Pink/Magenta (rhythm guitar)
  {
    main:      [255, 150, 180],
    staffLine: [200, 100, 130],
    barNumber: [200, 100, 130],
    secondary: [200, 100, 130],
    barSep:    [120, 60,  80],
  },
  // Track 2: Cyan/Teal (harmony / clean)
  {
    main:      [100, 255, 255],
    staffLine: [70,  180, 180],
    barNumber: [70,  180, 180],
    secondary: [70,  180, 180],
    barSep:    [40,  100, 100],
  },
  // Track 3: Gold/Amber (bass)
  {
    main:      [255, 210, 100],
    staffLine: [180, 150, 70],
    barNumber: [180, 150, 70],
    secondary: [180, 150, 70],
    barSep:    [100, 80,  40],
  },
  // Track 4: Green (additional)
  {
    main:      [100, 255, 130],
    staffLine: [70,  180, 90],
    barNumber: [70,  180, 90],
    secondary: [70,  180, 90],
    barSep:    [40,  100, 50],
  },
];

/**
 * @param {object} score - alphaTab Score object
 * @param {object} settings - alphaTab Settings object
 * @param {number} trackIndex - which track to render
 * @param {object} opts - rendering options
 * @param {boolean} opts.transparent - true for translucent overlay mode (alpha bg + white notation)
 * @param {number} opts.scale - notation scale factor (default 1.0, try 1.3-1.5 for larger tab numbers)
 * @param {number} opts.trackColorIndex - index into TRACK_PALETTES for multi-track color coding
 * @param {number[]} opts.notationHide - NotationElement enum values to hide
 */
export async function renderStrip(score, settings, trackIndex = 0, opts = {}) {
  const transparent = opts.transparent ?? false;
  const scale = opts.scale ?? 1.0;
  const colorIndex = opts.trackColorIndex ?? 0;
  const notationHide = opts.notationHide ?? [];

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

  // Apply notation element toggles (hide specific elements)
  if (notationHide.length > 0) {
    const uniqueElements = [...new Set(notationHide)];
    for (const element of uniqueElements) {
      settings.notation.elements.set(element, false);
    }
  }

  // Apply track color palette for multi-track differentiation
  const palette = TRACK_PALETTES[colorIndex % TRACK_PALETTES.length];
  const res = settings.display.resources;
  const c = (rgb) => new Color(rgb[0], rgb[1], rgb[2], 255);
  const cAlpha = (rgb, a) => new Color(rgb[0], rgb[1], rgb[2], a);

  res.mainGlyphColor = c(palette.main);           // Tab numbers, note heads, P.M., H, etc.
  res.staffLineColor = c(palette.staffLine);       // String lines
  res.barSeparatorColor = c(palette.barSep);       // Bar lines
  res.barNumberColor = c(palette.barNumber);       // Bar numbers
  res.secondaryGlyphColor = cAlpha(palette.secondary, 200); // Secondary notation elements
  res.scoreInfoColor = c(palette.main);            // Title/metadata

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
