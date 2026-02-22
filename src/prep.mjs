#!/usr/bin/env node
/**
 * prep.mjs -- Click track generator for recording sync
 *
 * Reads a Guitar Pro file's tempo map and generates a click track WAV.
 * Play in earbuds while filming, or load into Logic Pro as a reference track.
 * Guaranteed sync with gp-tab-video's tab scroll (same tempo source).
 *
 * Usage:
 *   node src/prep.mjs <file.gp> [options]
 *
 * Options:
 *   --output FILE     Output WAV path (default: output/<basename>_click.wav)
 *   --sample-rate N   Sample rate: 44100 or 48000 (default: 48000)
 *   --count-in N      Bars of count-in before bar 1 (default: 0)
 *   --no-accent       Equal volume for all beats (no downbeat accent)
 *   --track N         Track index for tuning display (default: 0)
 */

import { loadScore } from './load-score.mjs';
import { detectTuning } from './tuning.mjs';
import * as fs from 'fs';
import * as path from 'path';

const QUARTER_TIME = 960; // MIDI ticks per quarter note (alphaTab standard)

// --- CLI ---

function parseArgs(argv) {
  const opts = {
    gpFile: null,
    output: null,
    sampleRate: 48000,
    countIn: 0,
    accent: true,
    track: 0,
  };

  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if ((a === '--output' || a === '-o') && argv[i + 1]) {
      opts.output = argv[++i];
    } else if (a === '--sample-rate' && argv[i + 1]) {
      opts.sampleRate = parseInt(argv[++i], 10);
    } else if (a === '--count-in' && argv[i + 1]) {
      opts.countIn = parseInt(argv[++i], 10);
    } else if (a === '--no-accent') {
      opts.accent = false;
    } else if (a === '--track' && argv[i + 1]) {
      opts.track = parseInt(argv[++i], 10);
    } else if (a.startsWith('-')) {
      console.error(`Unknown option: ${a}`);
      process.exit(1);
    } else {
      positional.push(a);
    }
  }

  opts.gpFile = positional[0];
  return opts;
}

// --- Tempo map ---

function buildTempoMap(score) {
  const tempoChanges = [{ tick: 0, bpm: score.tempo }];

  for (const masterBar of score.masterBars) {
    if (masterBar.tempoAutomation) {
      tempoChanges.push({
        tick: masterBar.start,
        bpm: masterBar.tempoAutomation.value,
      });
    }
  }
  tempoChanges.sort((a, b) => a.tick - b.tick);

  function tickToMs(targetTick) {
    let ms = 0;
    let prevTick = 0;
    let bpm = tempoChanges[0].bpm;

    for (let i = 1; i < tempoChanges.length; i++) {
      const tc = tempoChanges[i];
      if (tc.tick >= targetTick) break;
      ms += ((tc.tick - prevTick) / QUARTER_TIME) * (60000 / bpm);
      bpm = tc.bpm;
      prevTick = tc.tick;
    }
    ms += ((targetTick - prevTick) / QUARTER_TIME) * (60000 / bpm);
    return ms;
  }

  const lastMasterBar = score.masterBars[score.masterBars.length - 1];
  const songEndTick = lastMasterBar.start + lastMasterBar.calculateDuration();
  const songDurationMs = tickToMs(songEndTick);

  return { tempoChanges, tickToMs, songDurationMs };
}

// --- Beat events ---

function generateClickEvents(score, tickToMs) {
  const clicks = [];

  for (let i = 0; i < score.masterBars.length; i++) {
    const mb = score.masterBars[i];
    const timeSigNum = mb.timeSignatureNumerator;
    const timeSigDen = mb.timeSignatureDenominator;
    const beatDurationTicks = QUARTER_TIME * (4 / timeSigDen);

    for (let beat = 0; beat < timeSigNum; beat++) {
      const tick = mb.start + beat * beatDurationTicks;
      const ms = tickToMs(tick);
      clicks.push({
        ms,
        barNumber: i + 1,
        beat: beat + 1,
        isDownbeat: beat === 0,
        timeSig: `${timeSigNum}/${timeSigDen}`,
      });
    }
  }

  return clicks;
}

function addCountIn(clicks, score, countInBars) {
  if (countInBars <= 0) return { clicks, offsetMs: 0 };

  const firstBar = score.masterBars[0];
  const timeSigNum = firstBar.timeSignatureNumerator;
  const timeSigDen = firstBar.timeSignatureDenominator;
  const bpm = score.tempo;

  // Duration of one beat in ms
  const beatMs = (60000 / bpm) * (4 / timeSigDen);
  const barMs = beatMs * timeSigNum;
  const offsetMs = barMs * countInBars;

  const countInClicks = [];
  for (let bar = 0; bar < countInBars; bar++) {
    for (let beat = 0; beat < timeSigNum; beat++) {
      countInClicks.push({
        ms: bar * barMs + beat * beatMs,
        barNumber: -(countInBars - bar) + 1, // negative bar numbers for count-in
        beat: beat + 1,
        isDownbeat: beat === 0,
        timeSig: `${timeSigNum}/${timeSigDen}`,
      });
    }
  }

  // Offset all song clicks
  const shifted = clicks.map((c) => ({ ...c, ms: c.ms + offsetMs }));

  return { clicks: [...countInClicks, ...shifted], offsetMs };
}

// --- Audio synthesis ---

function generateClickSample(sampleRate, frequency, durationMs, amplitude) {
  const numSamples = Math.floor((sampleRate * durationMs) / 1000);
  const samples = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const envelope = Math.exp(-t * 200); // fast exponential decay
    samples[i] = Math.sin(2 * Math.PI * frequency * t) * envelope * amplitude;
  }
  return samples;
}

function renderClickTrack(clicks, totalDurationMs, sampleRate, accent) {
  const totalSamples = Math.ceil((sampleRate * totalDurationMs) / 1000);
  const audio = new Float32Array(totalSamples);

  // Pre-generate click sounds
  const hiClick = generateClickSample(sampleRate, 1000, 8, 0.9);  // downbeat
  const loClick = generateClickSample(sampleRate, 800, 6, 0.6);   // other beats

  for (const click of clicks) {
    const samplePos = Math.floor((sampleRate * click.ms) / 1000);
    const clickSound = (accent && click.isDownbeat) ? hiClick : loClick;

    for (let j = 0; j < clickSound.length && samplePos + j < totalSamples; j++) {
      audio[samplePos + j] += clickSound[j];
    }
  }

  return audio;
}

// --- WAV encoding ---

function writeWav(filePath, samples, sampleRate) {
  const numSamples = samples.length;
  const bytesPerSample = 2; // 16-bit
  const dataSize = numSamples * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  // fmt subchunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);         // PCM
  buffer.writeUInt16LE(1, 22);         // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28);
  buffer.writeUInt16LE(bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);        // bits per sample

  // data subchunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const val = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(val * 32767), 44 + i * 2);
  }

  fs.writeFileSync(filePath, buffer);
}

// --- Section markers ---

function extractSections(score) {
  const sections = [];
  for (let i = 0; i < score.masterBars.length; i++) {
    const mb = score.masterBars[i];
    if (!mb.section) continue;
    const text = (mb.section.text || mb.section.marker || '').trim();
    if (text) sections.push({ barNumber: i + 1, text });
  }
  return sections;
}

// --- Tempo map summary ---

function buildTempoSummary(score) {
  const ranges = [];
  let currentBpm = score.tempo;
  let currentTimeSig = `${score.masterBars[0].timeSignatureNumerator}/${score.masterBars[0].timeSignatureDenominator}`;
  let rangeStart = 1;

  for (let i = 0; i < score.masterBars.length; i++) {
    const mb = score.masterBars[i];
    const timeSig = `${mb.timeSignatureNumerator}/${mb.timeSignatureDenominator}`;
    const bpm = mb.tempoAutomation ? mb.tempoAutomation.value : currentBpm;

    if (bpm !== currentBpm || timeSig !== currentTimeSig) {
      ranges.push({ start: rangeStart, end: i, bpm: currentBpm, timeSig: currentTimeSig });
      currentBpm = bpm;
      currentTimeSig = timeSig;
      rangeStart = i + 1;
    }
  }
  ranges.push({ start: rangeStart, end: score.masterBars.length, bpm: currentBpm, timeSig: currentTimeSig });

  return ranges;
}

// --- Main ---

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!opts.gpFile) {
    console.error('Usage: node src/prep.mjs <file.gp> [options]');
    console.error('');
    console.error('Generates a click track WAV from a Guitar Pro file\'s tempo map.');
    console.error('Play in earbuds while filming, or load into Logic Pro as reference.');
    console.error('');
    console.error('Options:');
    console.error('  -o, --output FILE   Output WAV path (default: output/<name>_click.wav)');
    console.error('  --sample-rate N     44100 or 48000 (default: 48000)');
    console.error('  --count-in N        Bars of count-in before bar 1 (default: 0)');
    console.error('  --no-accent         Equal volume for all beats (no downbeat accent)');
    console.error('  --track N           Track index for tuning display (default: 0)');
    process.exit(1);
  }

  const gpPath = path.resolve(opts.gpFile);
  if (!fs.existsSync(gpPath)) {
    throw new Error(`File not found: ${gpPath}`);
  }

  // Load score
  console.log(`\nLoading ${path.basename(gpPath)}...`);
  const { score } = await loadScore(gpPath);

  // Basic info
  console.log(`  Title: ${score.title || '(untitled)'}`);
  console.log(`  Tracks: ${score.tracks.map((t, i) => `[${i}] ${t.name}`).join(', ')}`);
  console.log(`  Bars: ${score.masterBars.length}`);

  // Tuning
  const track = score.tracks[opts.track];
  if (track) {
    const staff = track.staves[0];
    const tunings = staff?.stringTuning?.tunings || [];
    if (tunings.length > 0) {
      const { name, notes } = detectTuning(tunings, tunings.length);
      console.log(`  Track ${opts.track}: ${track.name} -- ${name} (${notes})`);
    }
  }

  // Tempo map
  const { tempoChanges, tickToMs, songDurationMs } = buildTempoMap(score);
  console.log(`  Duration: ${(songDurationMs / 1000).toFixed(1)}s`);

  // Tempo summary
  const tempoRanges = buildTempoSummary(score);
  console.log(`\nTempo Map:`);
  if (tempoRanges.length === 1) {
    const r = tempoRanges[0];
    console.log(`  ${r.bpm} BPM throughout (${r.timeSig})`);
  } else {
    for (const r of tempoRanges) {
      const barRange = r.start === r.end ? `Bar ${r.start}` : `Bars ${r.start}-${r.end}`;
      console.log(`  ${barRange.padEnd(14)} ${r.bpm} BPM (${r.timeSig})`);
    }
  }

  // Section markers
  const sections = extractSections(score);
  if (sections.length > 0) {
    console.log(`\nSections:`);
    for (const s of sections) {
      console.log(`  [${String(s.barNumber).padStart(3)}] ${s.text}`);
    }
  }

  // Generate click events
  let clicks = generateClickEvents(score, tickToMs);
  let totalDurationMs = songDurationMs;

  // Count-in
  if (opts.countIn > 0) {
    const result = addCountIn(clicks, score, opts.countIn);
    clicks = result.clicks;
    totalDurationMs += result.offsetMs;
    console.log(`\nCount-in: ${opts.countIn} bar(s) at ${score.tempo} BPM`);
  }

  // Synthesize audio
  console.log(`\nGenerating click track...`);
  const audio = renderClickTrack(clicks, totalDurationMs, opts.sampleRate, opts.accent);

  // Output path
  const outputPath = opts.output
    ? path.resolve(opts.output)
    : path.resolve('output', path.basename(gpPath, path.extname(gpPath)) + '_click.wav');

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  writeWav(outputPath, audio, opts.sampleRate);

  const fileSizeKb = Math.round(fs.statSync(outputPath).size / 1024);
  console.log(`  ${path.basename(outputPath)} (${opts.sampleRate / 1000}kHz, 16-bit mono, ${(totalDurationMs / 1000).toFixed(1)}s, ${fileSizeKb}KB)`);

  // Logic Pro setup instructions
  console.log(`\nLogic Pro setup:`);
  console.log(`  1. New session -> set tempo to ${tempoRanges[0].bpm} BPM`);
  if (tempoRanges.length > 1) {
    console.log(`  2. Add tempo automation:`);
    for (let i = 1; i < tempoRanges.length; i++) {
      const r = tempoRanges[i];
      console.log(`     Bar ${r.start}: ${r.bpm} BPM`);
    }
    console.log(`  3. Import click WAV to verify sync`);
    console.log(`  4. Record DI + bounce mix as WAV`);
  } else {
    console.log(`  2. Import click WAV to verify sync`);
    console.log(`  3. Record DI + bounce mix as WAV`);
  }

  console.log(`\nOpen with: open '${outputPath}'`);
}

main().catch((err) => {
  console.error('\nFATAL:', err.message);
  process.exit(1);
});
