#!/usr/bin/env node
/**
 * practice.mjs -- Adaptive Practice Engine
 *
 * Analyzes a Guitar Pro file's difficulty per bar, groups bars into
 * practice chunks, and generates structured practice sessions with
 * click tracks at progressive tempos. Tracks mastery across sessions.
 *
 * Usage:
 *   node src/practice.mjs <file.gp> [command] [options]
 *
 * Commands:
 *   analyze          Difficulty analysis + chunk map (default)
 *   session          Generate today's practice session
 *   progress         Show mastery across all chunks
 *   rate             Rate chunks after practicing (e.g. rate chunk-0:5 chunk-1:3)
 *   click <id>       Generate click track for a chunk at practice tempo
 *   reset            Clear practice state
 *   serve [port]     Launch browser UI (default port: 3001)
 *
 * Options:
 *   --track N          Track index (default: 0)
 *   --session-time N   Session length in minutes (default: 30)
 *   --output DIR       Output dir for click WAVs (default: output/)
 */

import { loadScore } from './load-score.mjs';
import { detectTuning } from './tuning.mjs';
import {
  WEIGHTS, MASTERY_LEVELS, TEMPO_TIERS,
  parseArgs, buildTempoMap, extractSections,
  extractBarFeatures, emptyFeatures,
  sigmoid, computeMedians, scoreDifficulty,
  extractShape, extractRhythm, featureDistance, buildChunks,
  buildSession,
  generateClickSample, renderClickTrack,
} from './practice-engine.mjs';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as readline from 'readline';
import http from 'http';
import { fileURLToPath } from 'url';

const QUARTER_TIME = 960;

function writeWav(filePath, samples, sampleRate) {
  const numSamples = samples.length;
  const bytesPerSample = 2;
  const dataSize = numSamples * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28);
  buffer.writeUInt16LE(bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const val = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(val * 32767), 44 + i * 2);
  }
  fs.writeFileSync(filePath, buffer);
}

function hashFile(filePath) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
}

function statePath(gpPath, outputDir) {
  const base = path.basename(gpPath, path.extname(gpPath));
  return path.resolve(outputDir, `${base}_practice.json`);
}

function loadState(gpPath, outputDir, chunks, baseTempo) {
  const sp = statePath(gpPath, outputDir);
  const gpHash = hashFile(gpPath);

  if (fs.existsSync(sp)) {
    const data = JSON.parse(fs.readFileSync(sp, 'utf-8'));
    if (data.gpFileHash === gpHash) {
      for (const chunk of chunks) {
        if (!data.chunks[chunk.id]) {
          data.chunks[chunk.id] = {
            barRange: chunk.barRange,
            difficulty: chunk.difficulty,
            masteryLevel: 0,
            lastPracticed: null,
            nextReview: null,
            history: [],
          };
        }
      }
      return data;
    }
    console.log('  GP file changed -- resetting practice state.');
  }

  const state = {
    version: 1,
    gpFile: path.basename(gpPath),
    gpFileHash: gpHash,
    baseTempo,
    sessionCount: 0,
    lastSession: null,
    chunks: {},
  };

  for (const chunk of chunks) {
    state.chunks[chunk.id] = {
      barRange: chunk.barRange,
      difficulty: chunk.difficulty,
      masteryLevel: 0,
      lastPracticed: null,
      nextReview: null,
      history: [],
    };
  }

  return state;
}

function saveState(state, gpPath, outputDir) {
  const sp = statePath(gpPath, outputDir);
  const dir = path.dirname(sp);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(sp, JSON.stringify(state, null, 2) + '\n');
}

function generateChunkClick(score, chunk, targetBpm, sampleRate = 48000) {
  const clicks = [];
  const startIdx = chunk.barRange[0] - 1;
  const endIdx = chunk.barRange[1] - 1;

  // 1-bar count-in
  const firstMb = score.masterBars[startIdx];
  const timeSigNum = firstMb.timeSignatureNumerator;
  const timeSigDen = firstMb.timeSignatureDenominator;
  const beatMs = (60000 / targetBpm) * (4 / timeSigDen);
  const countInMs = beatMs * timeSigNum;

  for (let beat = 0; beat < timeSigNum; beat++) {
    clicks.push({ ms: beat * beatMs, isDownbeat: beat === 0 });
  }

  // Chunk bars
  let barOffset = 0;
  for (let i = startIdx; i <= endIdx; i++) {
    const mb = score.masterBars[i];
    const tsNum = mb.timeSignatureNumerator;
    const tsDen = mb.timeSignatureDenominator;
    const beatDur = (60000 / targetBpm) * (4 / tsDen);

    for (let beat = 0; beat < tsNum; beat++) {
      clicks.push({
        ms: countInMs + barOffset + beat * beatDur,
        isDownbeat: beat === 0,
      });
    }
    barOffset += tsNum * beatDur;
  }

  const totalDurationMs = countInMs + barOffset + 500; // 500ms tail
  const audio = renderClickTrack(clicks, totalDurationMs, sampleRate);
  return { audio, totalDurationMs, sampleRate };
}

// --- Console output ---

function printHeader(score, track, songDurationMs) {
  console.log(`  Title: ${score.title || '(untitled)'}`);
  const staff = track.staves[0];
  const tunings = staff?.stringTuning?.tunings || [];
  if (tunings.length > 0) {
    const { name, notes } = detectTuning(tunings, tunings.length);
    console.log(`  Track: ${track.name} -- ${name} (${notes})`);
  } else {
    console.log(`  Track: ${track.name}`);
  }
  console.log(`  Bars: ${score.masterBars.length} | Tempo: ${score.tempo} BPM | Duration: ${(songDurationMs / 1000).toFixed(1)}s`);
}

function printAnalysis(barFeatures, chunks) {
  // Bar table
  console.log('\nBAR ANALYSIS');
  console.log('============');
  console.log('  Bar  Diff  Notes  Strings  Span  Shift  Tech   Rhythm  Techniques');
  console.log('  ---  ----  -----  -------  ----  -----  -----  ------  ----------');

  for (const f of barFeatures) {
    if (f.isEmpty) continue;
    const techStr = f.techniques.length > 0 ? f.techniques.join(', ') : '--';
    console.log(
      `  ${String(f.barNumber).padStart(3)}` +
      `  ${String(f.difficulty).padStart(4)}` +
      `  ${f.noteDensity.toFixed(1).padStart(5)}` +
      `  ${String(f.stringCrossings).padStart(7)}` +
      `  ${String(f.fretSpan).padStart(4)}` +
      `  ${f.positionShifts.toFixed(0).padStart(5)}` +
      `  ${f.techniqueScore.toFixed(1).padStart(5)}` +
      `  ${f.rhythmScore.toFixed(1).padStart(6)}` +
      `  ${techStr}`
    );
  }

  // Difficulty distribution
  const nonEmpty = barFeatures.filter(f => !f.isEmpty);
  const buckets = [
    { label: '90-100', min: 90, max: 100 },
    { label: '70-89 ', min: 70, max: 89 },
    { label: '50-69 ', min: 50, max: 69 },
    { label: '30-49 ', min: 30, max: 49 },
    { label: '0-29  ', min: 0, max: 29 },
  ];

  console.log('\nDIFFICULTY DISTRIBUTION');
  for (const bucket of buckets) {
    const count = nonEmpty.filter(f => f.difficulty >= bucket.min && f.difficulty <= bucket.max).length;
    const bar = '#'.repeat(Math.min(count * 2, 40));
    const tag = bucket.min >= 90 ? '(hardest)' : bucket.min === 0 ? '(easiest)' : '';
    console.log(`  [${bucket.label}]  ${bar.padEnd(30)} ${String(count).padStart(3)} bars  ${tag}`);
  }

  // Chunks
  console.log('\nCHUNKS');
  console.log('  ID          Bars        Diff  Techniques');
  console.log('  ----------  ----------  ----  ----------');
  for (const chunk of chunks) {
    const barStr = chunk.barRange[0] === chunk.barRange[1]
      ? `Bar ${chunk.barRange[0]}`
      : `Bars ${chunk.barRange[0]}-${chunk.barRange[1]}`;
    const techStr = chunk.techniques.length > 0 ? chunk.techniques.join(', ') : '--';
    console.log(
      `  ${chunk.id.padEnd(10)}` +
      `  ${barStr.padEnd(10)}` +
      `  ${String(chunk.difficulty).padStart(4)}` +
      `  ${techStr}`
    );
  }

  // Practice order
  const sorted = chunks.slice().sort((a, b) => b.difficulty - a.difficulty);
  console.log('\nPRACTICE ORDER (hardest first)');
  sorted.forEach((chunk, i) => {
    const barStr = chunk.barRange[0] === chunk.barRange[1]
      ? `Bar ${chunk.barRange[0]}`
      : `Bars ${chunk.barRange[0]}-${chunk.barRange[1]}`;
    const techStr = chunk.techniques.length > 0 ? chunk.techniques.join(', ') : '';
    console.log(`  ${i + 1}. ${chunk.id} (${chunk.difficulty}) ${barStr} -- ${chunk.label}${techStr ? ' [' + techStr + ']' : ''}`);
  });
}

function printSession(session, outputDir) {
  console.log(`\nPRACTICE SESSION #${session.sessionNumber}`);
  console.log('='.repeat(50));
  console.log(`Date: ${new Date(session.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`);
  console.log(`Target: ${session.totalMinutes} min | Base tempo: ${session.baseTempo} BPM\n`);

  // Phase 1: Isolation
  console.log(`PHASE 1: ISOLATION (~${session.phaseTime.isolation} min)`);
  console.log('  Hardest chunks, slow tempos. Focus on clean execution.');
  console.log('  30 sec rest between chunks.\n');

  session.isolation.forEach((item, i) => {
    const chunk = item.chunk;
    const barStr = chunk.barRange[0] === chunk.barRange[1]
      ? `Bar ${chunk.barRange[0]}`
      : `Bars ${chunk.barRange[0]}-${chunk.barRange[1]}`;
    const reviewTag = item.isReview ? ' [REVIEW]' : '';
    console.log(`  ${i + 1}. ${chunk.id}  ${barStr} (${chunk.label})`);
    console.log(`     ${item.level} -- ${item.bpm} BPM (${Math.round(item.tempoPct * 100)}%) -- ${item.reps} reps${reviewTag}`);

    const clickFile = path.join(outputDir, `practice_${chunk.id}_${item.bpm}bpm.wav`);
    console.log(`     Click: ${clickFile}`);
    console.log('');
  });

  // Phase 2: Context
  if (session.context.length > 0) {
    console.log(`\nPHASE 2: CONTEXT (~${session.phaseTime.context} min)`);
    console.log('  Connect adjacent chunks. Focus on smooth transitions.\n');

    session.context.forEach((pair, i) => {
      const n = session.isolation.length + i + 1;
      const barStr = `Bars ${pair.barRange[0]}-${pair.barRange[1]}`;
      console.log(`  ${n}. ${pair.chunks.map(c => c.id).join(' + ')}  ${barStr}`);
      console.log(`     ${pair.bpm} BPM (${Math.round(pair.tempoPct * 100)}%) -- play through, focus on transitions`);
      console.log('');
    });
  }

  // Phase 3: Interleaving
  if (session.interleaving.chunks.length > 0) {
    console.log(`\nPHASE 3: INTERLEAVING (~${session.phaseTime.interleaving} min)`);
    console.log('  Random order. Forces recall for long-term retention.\n');

    const n = session.isolation.length + session.context.length + 1;
    const ids = session.interleaving.chunks.map(c => c.id).join(', ');
    console.log(`  ${n}. Random order: ${ids}`);
    console.log(`     ${session.interleaving.bpm} BPM (${Math.round(session.interleaving.tempoPct * 100)}%) -- 2 reps each, shuffle order`);
  }

  // Phase 4: Run-through
  console.log(`\nPHASE 4: RUN-THROUGH (~${session.phaseTime.runthrough} min)`);
  console.log(`  Full piece at ${session.runthrough.bpm} BPM (${Math.round(session.runthrough.tempoPct * 100)}%).`);
  console.log('  Note problem spots for next session.\n');

  console.log('After practice:');
  console.log('  node src/practice.mjs <file.gp> rate chunk-0:5 chunk-1:3 ...');
  console.log('  (1=Struggled, 3=Okay, 5=Clean)');
}

function printProgress(chunks, state) {
  console.log('\nPROGRESS');
  console.log('========');
  console.log(`Sessions completed: ${state.sessionCount}`);
  if (state.lastSession) {
    console.log(`Last session: ${new Date(state.lastSession).toLocaleDateString()}`);
  }
  console.log('');
  console.log('  Chunk       Bars        Diff  Mastery      Tempo   Next Review');
  console.log('  ----------  ----------  ----  -----------  ------  -----------');

  const now = new Date();
  for (const chunk of chunks) {
    const cs = state.chunks[chunk.id];
    if (!cs) continue;

    const level = MASTERY_LEVELS[cs.masteryLevel] || MASTERY_LEVELS[0];
    const barStr = chunk.barRange[0] === chunk.barRange[1]
      ? `Bar ${chunk.barRange[0]}`
      : `Bars ${chunk.barRange[0]}-${chunk.barRange[1]}`;
    const bpm = Math.round(state.baseTempo * level.tempoPct);

    let reviewStr = 'Now';
    if (cs.nextReview) {
      const reviewDate = new Date(cs.nextReview);
      if (reviewDate <= now) {
        reviewStr = 'Due';
      } else {
        const days = Math.ceil((reviewDate - now) / (1000 * 60 * 60 * 24));
        reviewStr = `${days}d`;
      }
    }

    // Progress bar
    const filled = Math.round((cs.masteryLevel / 5) * 10);
    const progressBar = '[' + '#'.repeat(filled) + '-'.repeat(10 - filled) + ']';

    console.log(
      `  ${chunk.id.padEnd(10)}` +
      `  ${barStr.padEnd(10)}` +
      `  ${String(chunk.difficulty).padStart(4)}` +
      `  ${(level.name + ' ' + progressBar).padEnd(23)}` +
      `  ${(bpm + ' BPM').padStart(7)}` +
      `  ${reviewStr}`
    );
  }

  // Summary stats
  const totalChunks = chunks.length;
  const mastered = chunks.filter(c => (state.chunks[c.id]?.masteryLevel || 0) >= 5).length;
  const solid = chunks.filter(c => (state.chunks[c.id]?.masteryLevel || 0) >= 4).length;
  const learning = chunks.filter(c => {
    const lvl = state.chunks[c.id]?.masteryLevel || 0;
    return lvl > 0 && lvl < 4;
  }).length;
  const newChunks = chunks.filter(c => (state.chunks[c.id]?.masteryLevel || 0) === 0).length;

  console.log(`\n  Mastered: ${mastered}/${totalChunks} | Solid: ${solid}/${totalChunks} | Learning: ${learning}/${totalChunks} | New: ${newChunks}/${totalChunks}`);

  if (totalChunks > 0) {
    const overallPct = Math.round((mastered / totalChunks) * 100);
    const bar = '#'.repeat(Math.round(overallPct / 5));
    console.log(`  Overall: [${bar.padEnd(20)}] ${overallPct}%`);
  }
}

// --- Command handlers ---

async function cmdAnalyze(score, track, opts, songDurationMs) {
  const sections = extractSections(score);
  const barFeatures = extractBarFeatures(score, opts.track);
  const medians = computeMedians(barFeatures);

  // Attach difficulty scores
  for (const f of barFeatures) {
    f.difficulty = scoreDifficulty(f, medians);
  }

  const chunks = buildChunks(score, track, barFeatures, sections);

  printHeader(score, track, songDurationMs);
  printAnalysis(barFeatures, chunks);

  return { barFeatures, chunks, sections };
}

async function cmdSession(score, track, opts, songDurationMs) {
  const sections = extractSections(score);
  const barFeatures = extractBarFeatures(score, opts.track);
  const medians = computeMedians(barFeatures);
  for (const f of barFeatures) {
    f.difficulty = scoreDifficulty(f, medians);
  }
  const chunks = buildChunks(score, track, barFeatures, sections);

  const gpPath = path.resolve(opts.gpFile);
  const state = loadState(gpPath, opts.output, chunks, score.tempo);

  const session = buildSession(chunks, state, score.tempo, opts.sessionTime);

  printHeader(score, track, songDurationMs);
  printSession(session, opts.output);

  // Generate click tracks for isolation phase
  const outputDir = path.resolve(opts.output);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  console.log('\nGenerating click tracks...');
  for (const item of session.isolation) {
    const { audio, totalDurationMs, sampleRate } = generateChunkClick(
      score, item.chunk, item.bpm
    );
    const fileName = `practice_${item.chunk.id}_${item.bpm}bpm.wav`;
    const filePath = path.join(outputDir, fileName);
    writeWav(filePath, audio, sampleRate);
    const sizeKb = Math.round(fs.statSync(filePath).size / 1024);
    console.log(`  ${fileName} (${(totalDurationMs / 1000).toFixed(1)}s, ${sizeKb}KB)`);
  }

  // Save state (increment session count)
  state.sessionCount++;
  state.lastSession = new Date().toISOString();
  saveState(state, gpPath, opts.output);
}

async function cmdProgress(score, track, opts, songDurationMs) {
  const sections = extractSections(score);
  const barFeatures = extractBarFeatures(score, opts.track);
  const medians = computeMedians(barFeatures);
  for (const f of barFeatures) {
    f.difficulty = scoreDifficulty(f, medians);
  }
  const chunks = buildChunks(score, track, barFeatures, sections);

  const gpPath = path.resolve(opts.gpFile);
  const state = loadState(gpPath, opts.output, chunks, score.tempo);

  printHeader(score, track, songDurationMs);
  printProgress(chunks, state);
}

async function cmdRate(score, track, opts, songDurationMs) {
  const sections = extractSections(score);
  const barFeatures = extractBarFeatures(score, opts.track);
  const medians = computeMedians(barFeatures);
  for (const f of barFeatures) {
    f.difficulty = scoreDifficulty(f, medians);
  }
  const chunks = buildChunks(score, track, barFeatures, sections);

  const gpPath = path.resolve(opts.gpFile);
  const state = loadState(gpPath, opts.output, chunks, score.tempo);

  // Parse ratings from commandArgs: "chunk-0:5 chunk-1:3"
  const ratings = {};
  for (const arg of opts.commandArgs) {
    const parts = arg.split(':');
    if (parts.length === 2) {
      ratings[parts[0]] = parseInt(parts[1], 10);
    }
  }

  if (Object.keys(ratings).length === 0) {
    // Interactive mode
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q) => new Promise(r => rl.question(q, r));

    console.log('\nRATE YOUR PRACTICE');
    console.log('==================');
    console.log('Rate each chunk: 1=Struggled, 3=Okay, 5=Clean\n');

    for (const chunk of chunks) {
      const cs = state.chunks[chunk.id];
      if (!cs) continue;
      const level = MASTERY_LEVELS[cs.masteryLevel] || MASTERY_LEVELS[0];
      const bpm = Math.round(state.baseTempo * level.tempoPct);
      const barStr = chunk.barRange[0] === chunk.barRange[1]
        ? `Bar ${chunk.barRange[0]}`
        : `Bars ${chunk.barRange[0]}-${chunk.barRange[1]}`;

      const answer = await ask(`  ${chunk.id} ${barStr} at ${bpm} BPM [1/3/5 or Enter to skip]: `);
      const rating = parseInt(answer.trim(), 10);
      if (rating === 1 || rating === 3 || rating === 5) {
        ratings[chunk.id] = rating;
      }
    }
    rl.close();
  }

  // Apply ratings
  const now = new Date();
  console.log('\nUpdated:');
  for (const [chunkId, rating] of Object.entries(ratings)) {
    const cs = state.chunks[chunkId];
    if (!cs) {
      console.log(`  ${chunkId}: not found`);
      continue;
    }

    const prevLevel = cs.masteryLevel;
    if (rating >= 4) {
      cs.masteryLevel = Math.min(5, cs.masteryLevel + 1);
    } else if (rating <= 2) {
      cs.masteryLevel = Math.max(0, cs.masteryLevel - 1);
    }

    const level = MASTERY_LEVELS[cs.masteryLevel];
    cs.lastPracticed = now.toISOString();
    const intervalDays = level.interval;
    const nextReview = new Date(now);
    nextReview.setDate(nextReview.getDate() + intervalDays);
    cs.nextReview = nextReview.toISOString();
    cs.history.push({
      date: now.toISOString(),
      rating,
      tempo: Math.round(state.baseTempo * MASTERY_LEVELS[prevLevel].tempoPct),
    });

    const arrow = cs.masteryLevel > prevLevel ? ' ^' : cs.masteryLevel < prevLevel ? ' v' : '';
    console.log(`  ${chunkId}: ${level.name} (${Math.round(level.tempoPct * 100)}%) -- review in ${intervalDays}d${arrow}`);
  }

  saveState(state, gpPath, opts.output);
}

async function cmdClick(score, track, opts) {
  const chunkId = opts.commandArgs[0];
  if (!chunkId) {
    console.error('Usage: node src/practice.mjs <file.gp> click <chunk-id> [--tempo-pct 0.55]');
    process.exit(1);
  }

  const sections = extractSections(score);
  const barFeatures = extractBarFeatures(score, opts.track);
  const medians = computeMedians(barFeatures);
  for (const f of barFeatures) {
    f.difficulty = scoreDifficulty(f, medians);
  }
  const chunks = buildChunks(score, track, barFeatures, sections);

  const chunk = chunks.find(c => c.id === chunkId);
  if (!chunk) {
    console.error(`Chunk not found: ${chunkId}`);
    console.error(`Available: ${chunks.map(c => c.id).join(', ')}`);
    process.exit(1);
  }

  const gpPath = path.resolve(opts.gpFile);
  const state = loadState(gpPath, opts.output, chunks, score.tempo);
  const cs = state.chunks[chunkId] || { masteryLevel: 0 };
  const level = MASTERY_LEVELS[cs.masteryLevel] || MASTERY_LEVELS[0];
  const bpm = Math.round(score.tempo * level.tempoPct);

  const { audio, totalDurationMs, sampleRate } = generateChunkClick(score, chunk, bpm);

  const outputDir = path.resolve(opts.output);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const fileName = `practice_${chunkId}_${bpm}bpm.wav`;
  const filePath = path.join(outputDir, fileName);
  writeWav(filePath, audio, sampleRate);

  const barStr = `Bars ${chunk.barRange[0]}-${chunk.barRange[1]}`;
  console.log(`Click track: ${filePath}`);
  console.log(`  ${chunkId} (${barStr}) at ${bpm} BPM (${Math.round(level.tempoPct * 100)}%)`);
  console.log(`  Duration: ${(totalDurationMs / 1000).toFixed(1)}s (includes 1-bar count-in)`);
  console.log(`\nOpen with: open '${filePath}'`);
}

async function cmdReset(opts) {
  const gpPath = path.resolve(opts.gpFile);
  const sp = statePath(gpPath, opts.output);
  if (fs.existsSync(sp)) {
    fs.unlinkSync(sp);
    console.log(`Deleted: ${sp}`);
  } else {
    console.log('No practice state to reset.');
  }
}

// --- HTTP Server (serve command) ---

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.otf': 'font/otf',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.sf2': 'application/octet-stream',
  '.wav': 'audio/wav',
  '.gp': 'application/octet-stream',
  '.gp5': 'application/octet-stream',
  '.gpx': 'application/octet-stream',
};

async function cmdServe(initialScore, initialTrack, opts, initialDurationMs) {
  // --- Mutable state (reassigned when a new exercise is generated) ---
  let gpPath = null;
  let score = null;
  let track = null;
  let sections = null;
  let barFeatures = null;
  let chunks = null;
  let songDurationMs = null;

  function reinitialize(newGpPath, newScore) {
    gpPath = newGpPath;
    score = newScore;
    track = score.tracks[opts.track] || score.tracks[0];
    sections = extractSections(score);
    barFeatures = extractBarFeatures(score, opts.track);
    const medians = computeMedians(barFeatures);
    for (const f of barFeatures) f.difficulty = scoreDifficulty(f, medians);
    chunks = buildChunks(score, track, barFeatures, sections);
    loadState(gpPath, opts.output, chunks, score.tempo);
    songDurationMs = buildTempoMap(score).songDurationMs;
  }

  // Initialize from file if provided
  if (initialScore) {
    gpPath = path.resolve(opts.gpFile);
    score = initialScore;
    track = initialTrack;
    sections = extractSections(score);
    barFeatures = extractBarFeatures(score, opts.track);
    const medians = computeMedians(barFeatures);
    for (const f of barFeatures) f.difficulty = scoreDifficulty(f, medians);
    chunks = buildChunks(score, track, barFeatures, sections);
    loadState(gpPath, opts.output, chunks, score.tempo);
    songDurationMs = initialDurationMs;
  }

  function noFileResponse(res) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'No file loaded', loaded: false }));
  }

  function buildFileInfo() {
    const tunings = track.staves[0]?.stringTuning?.tunings || [];
    let tuningInfo = null;
    if (tunings.length > 0) tuningInfo = detectTuning(tunings, tunings.length);
    return {
      file: path.basename(gpPath),
      title: score.title || '(untitled)',
      tempo: score.tempo,
      bars: score.masterBars.length,
      tracks: score.tracks.map((t, i) => ({ index: i, name: t.name })),
      activeTrack: opts.track,
      tuning: tuningInfo,
      durationMs: songDurationMs,
    };
  }

  // --- Remote API options cache ---
  const API_BASE = 'https://guitar-model-lab.onrender.com';
  let cachedOptions = null;

  async function fetchGenerateOptions() {
    if (cachedOptions) return cachedOptions;
    const [scalesRes, patternsRes, tuningsRes] = await Promise.all([
      fetch(`${API_BASE}/scales`),
      fetch(`${API_BASE}/patterns`),
      fetch(`${API_BASE}/tunings`),
    ]);
    const [scalesData, patternsData, tuningsData] = await Promise.all([
      scalesRes.json(), patternsRes.json(), tuningsRes.json(),
    ]);
    cachedOptions = {
      roots: ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'],
      scales: scalesData.scales || [],
      patterns: patternsData.patterns || [],
      tunings: tuningsData.tunings || [],
    };
    return cachedOptions;
  }

  const port = opts.commandArgs[0] ? parseInt(opts.commandArgs[0], 10) : 3001;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);

    // --- API endpoints ---

    if (url.pathname === '/api/file') {
      if (!score) { noFileResponse(res); return; }
      const data = fs.readFileSync(gpPath);
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': data.length,
      });
      res.end(data);
      return;
    }

    if (url.pathname === '/api/file-info') {
      if (!score) { noFileResponse(res); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(buildFileInfo()));
      return;
    }

    if (url.pathname === '/api/analyze') {
      if (!score) { noFileResponse(res); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ barFeatures, chunks, sections }));
      return;
    }

    if (url.pathname === '/api/session') {
      if (!score) { noFileResponse(res); return; }
      const currentState = loadState(gpPath, opts.output, chunks, score.tempo);
      const session = buildSession(chunks, currentState, score.tempo, opts.sessionTime);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ session, masteryLevels: MASTERY_LEVELS, tempoTiers: TEMPO_TIERS }));
      return;
    }

    if (url.pathname === '/api/progress') {
      if (!score) { noFileResponse(res); return; }
      const currentState = loadState(gpPath, opts.output, chunks, score.tempo);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        chunks,
        state: currentState,
        masteryLevels: MASTERY_LEVELS,
      }));
      return;
    }

    if (url.pathname === '/api/rate' && req.method === 'POST') {
      if (!score) { noFileResponse(res); return; }
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const { ratings } = JSON.parse(body);
          const currentState = loadState(gpPath, opts.output, chunks, score.tempo);
          const now = new Date();
          const updates = {};

          for (const [chunkId, rating] of Object.entries(ratings)) {
            const cs = currentState.chunks[chunkId];
            if (!cs) continue;

            const prevLevel = cs.masteryLevel;
            if (rating >= 4) {
              cs.masteryLevel = Math.min(5, cs.masteryLevel + 1);
            } else if (rating <= 2) {
              cs.masteryLevel = Math.max(0, cs.masteryLevel - 1);
            }

            const level = MASTERY_LEVELS[cs.masteryLevel];
            cs.lastPracticed = now.toISOString();
            const nextReview = new Date(now);
            nextReview.setDate(nextReview.getDate() + level.interval);
            cs.nextReview = nextReview.toISOString();
            cs.history.push({
              date: now.toISOString(),
              rating,
              tempo: Math.round(currentState.baseTempo * MASTERY_LEVELS[prevLevel].tempoPct),
            });

            updates[chunkId] = {
              masteryLevel: cs.masteryLevel,
              levelName: level.name,
              tempoPct: level.tempoPct,
              nextReview: cs.nextReview,
              changed: cs.masteryLevel !== prevLevel,
            };
          }

          saveState(currentState, gpPath, opts.output);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, updates, state: currentState }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // Click track endpoint: /api/click/chunk-0
    const clickMatch = url.pathname.match(/^\/api\/click\/(chunk-\d+)$/);
    if (clickMatch) {
      if (!score) { noFileResponse(res); return; }
      const chunkId = clickMatch[1];
      const chunk = chunks.find(c => c.id === chunkId);
      if (!chunk) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Chunk not found: ${chunkId}` }));
        return;
      }

      const currentState = loadState(gpPath, opts.output, chunks, score.tempo);
      const cs = currentState.chunks[chunkId] || { masteryLevel: 0 };
      const level = MASTERY_LEVELS[cs.masteryLevel] || MASTERY_LEVELS[0];
      const bpm = Math.round(score.tempo * level.tempoPct);

      const { audio, sampleRate } = generateChunkClick(score, chunk, bpm);

      // Write WAV to buffer
      const numSamples = audio.length;
      const bytesPerSample = 2;
      const dataSize = numSamples * bytesPerSample;
      const buffer = Buffer.alloc(44 + dataSize);
      buffer.write('RIFF', 0);
      buffer.writeUInt32LE(36 + dataSize, 4);
      buffer.write('WAVE', 8);
      buffer.write('fmt ', 12);
      buffer.writeUInt32LE(16, 16);
      buffer.writeUInt16LE(1, 20);
      buffer.writeUInt16LE(1, 22);
      buffer.writeUInt32LE(sampleRate, 24);
      buffer.writeUInt32LE(sampleRate * bytesPerSample, 28);
      buffer.writeUInt16LE(bytesPerSample, 32);
      buffer.writeUInt16LE(16, 34);
      buffer.write('data', 36);
      buffer.writeUInt32LE(dataSize, 40);
      for (let i = 0; i < numSamples; i++) {
        const val = Math.max(-1, Math.min(1, audio[i]));
        buffer.writeInt16LE(Math.round(val * 32767), 44 + i * 2);
      }

      res.writeHead(200, {
        'Content-Type': 'audio/wav',
        'Content-Length': buffer.length,
      });
      res.end(buffer);
      return;
    }

    // --- Generate options (cached remote API proxy) ---
    if (url.pathname === '/api/generate-options') {
      fetchGenerateOptions().then(options => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(options));
      }).catch(err => {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Failed to fetch options: ${err.message}` }));
      });
      return;
    }

    // --- Box position (proxy to guitar-model-lab for fretboard viz) ---
    if (url.pathname === '/api/box-position') {
      const qs = url.search || '';
      fetch(`${API_BASE}/box-position${qs}`)
        .then(async (apiRes) => {
          if (!apiRes.ok) {
            const errText = await apiRes.text();
            res.writeHead(apiRes.status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: errText }));
            return;
          }
          const data = await apiRes.json();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(data));
        })
        .catch(err => {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        });
      return;
    }

    // --- Generate exercise (proxy to guitar-model-lab) ---
    if (url.pathname === '/api/generate' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const params = JSON.parse(body);

          // Proxy to guitar-model-lab
          const apiRes = await fetch(`${API_BASE}/generate-gp5`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params),
          });

          if (!apiRes.ok) {
            const errText = await apiRes.text();
            res.writeHead(apiRes.status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `API error: ${errText}` }));
            return;
          }

          const gpBuffer = Buffer.from(await apiRes.arrayBuffer());

          // Save to output directory
          const outputDir = path.resolve(opts.output || 'output');
          if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
          const filename = `${params.root || 'E'}_${params.scale || 'phrygian'}_${params.pattern || 'ascending'}.gp5`;
          const savedPath = path.join(outputDir, filename);
          fs.writeFileSync(savedPath, gpBuffer);

          // Load and reinitialize
          const loaded = await loadScore(savedPath);
          reinitialize(savedPath, loaded.score);

          // Return combined data
          const currentState = loadState(gpPath, opts.output, chunks, score.tempo);
          const session = buildSession(chunks, currentState, score.tempo, opts.sessionTime);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: true,
            filename,
            fileInfo: buildFileInfo(),
            analyze: { barFeatures, chunks, sections },
            session: { session, masteryLevels: MASTERY_LEVELS, tempoTiers: TEMPO_TIERS },
            progress: { chunks, state: currentState, masteryLevels: MASTERY_LEVELS },
          }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // --- Static files ---
    let filePath;
    if (url.pathname === '/' || url.pathname === '/index.html') {
      filePath = path.join(PROJECT_ROOT, 'practice', 'index.html');
    } else {
      filePath = path.join(PROJECT_ROOT, url.pathname);
    }

    // Security: prevent directory traversal
    if (!filePath.startsWith(PROJECT_ROOT)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    const data = fs.readFileSync(filePath);

    res.writeHead(200, { 'Content-Type': mime, 'Content-Length': data.length });
    res.end(data);
  });

  server.listen(port, () => {
    const url = `http://localhost:${port}`;
    console.log(`\nPractice Engine -- Browser UI`);
    console.log(`  URL:   ${url}`);
    if (score) {
      console.log(`  File:  ${path.basename(gpPath)}`);
      console.log(`  Title: ${score.title || '(untitled)'}`);
      console.log(`  Track: [${opts.track}] ${track.name}`);
      console.log(`  Tempo: ${score.tempo} BPM | ${score.masterBars.length} bars | ${chunks.length} chunks`);
    } else {
      console.log(`  No file loaded -- use the Generate tab to create an exercise`);
    }
    console.log(`\nPress Ctrl+C to stop.\n`);

    import('child_process').then(({ exec }) => {
      exec(`open "${url}"`);
    });
  });
}

// --- Main ---

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  // Allow 'serve' without a GP file (generate-only mode)
  if (!opts.gpFile && opts.command === 'serve') {
    await cmdServe(null, null, opts, null);
    return;
  }

  if (!opts.gpFile) {
    console.error('Usage: node src/practice.mjs <file.gp> [command] [options]');
    console.error('       node src/practice.mjs serve [port]   (no file -- generate mode)');
    console.error('');
    console.error('Adaptive Practice Engine -- analyze difficulty, generate sessions,');
    console.error('track mastery with spaced repetition.');
    console.error('');
    console.error('Commands:');
    console.error('  analyze          Difficulty analysis + chunk map (default)');
    console.error('  session          Generate today\'s practice session');
    console.error('  progress         Show mastery progress');
    console.error('  rate             Rate chunks after practicing');
    console.error('  click <id>       Generate click track for a chunk');
    console.error('  serve [port]     Launch browser UI (default: 3001)');
    console.error('  reset            Clear practice state');
    console.error('');
    console.error('Options:');
    console.error('  --track N          Track index (default: 0)');
    console.error('  --session-time N   Session minutes (default: 30)');
    console.error('  --output DIR       Output directory (default: output/)');
    process.exit(1);
  }

  const gpPath = path.resolve(opts.gpFile);
  if (!fs.existsSync(gpPath)) {
    console.error(`File not found: ${gpPath}`);
    process.exit(1);
  }

  console.log(`\nLoading ${path.basename(gpPath)}...`);
  const { score } = await loadScore(gpPath);
  const track = score.tracks[opts.track];
  if (!track) {
    console.error(`Track ${opts.track} not found. Available: ${score.tracks.map((t, i) => `[${i}] ${t.name}`).join(', ')}`);
    process.exit(1);
  }

  const { songDurationMs } = buildTempoMap(score);

  switch (opts.command) {
    case 'analyze':
      await cmdAnalyze(score, track, opts, songDurationMs);
      break;
    case 'session':
      await cmdSession(score, track, opts, songDurationMs);
      break;
    case 'progress':
      await cmdProgress(score, track, opts, songDurationMs);
      break;
    case 'rate':
      await cmdRate(score, track, opts, songDurationMs);
      break;
    case 'click':
      await cmdClick(score, track, opts);
      break;
    case 'serve':
      await cmdServe(score, track, opts, songDurationMs);
      break;
    case 'reset':
      await cmdReset(opts);
      break;
    default:
      console.error(`Unknown command: ${opts.command}`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('\nFATAL:', err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
