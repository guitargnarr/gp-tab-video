/**
 * practice-engine.mjs -- Pure functions for the practice engine.
 *
 * Extracted from practice.mjs so they can be imported by both the CLI
 * and the test suite.  Every export here is a pure function (or constant)
 * with no I/O side-effects.
 */

const QUARTER_TIME = 960;

// --- Difficulty weights ---

export const WEIGHTS = {
  noteDensity:     0.25,
  stringCrossings: 0.20,
  positionShifts:  0.15,
  techniqueScore:  0.15,
  rhythmScore:     0.15,
  fretSpan:        0.10,
};

// --- Mastery system ---

export const MASTERY_LEVELS = [
  { name: 'New',        tempoPct: 0.40, interval: 0  },
  { name: 'Learning',   tempoPct: 0.55, interval: 1  },
  { name: 'Developing', tempoPct: 0.70, interval: 3  },
  { name: 'Proficient', tempoPct: 0.85, interval: 7  },
  { name: 'Solid',      tempoPct: 1.00, interval: 14 },
  { name: 'Mastered',   tempoPct: 1.00, interval: 30 },
];

export const TEMPO_TIERS = [
  { label: 'Crawl',  pct: 0.40, reps: 5 },
  { label: 'Slow',   pct: 0.55, reps: 4 },
  { label: 'Medium', pct: 0.70, reps: 3 },
  { label: 'Push',   pct: 0.85, reps: 3 },
  { label: 'Target', pct: 1.00, reps: 2 },
];

// --- CLI ---

export function parseArgs(argv) {
  const opts = {
    gpFile: null,
    command: 'analyze',
    commandArgs: [],
    track: 0,
    sessionTime: 30,
    output: 'output',
  };

  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--track' && argv[i + 1]) {
      opts.track = parseInt(argv[++i], 10);
    } else if (a === '--session-time' && argv[i + 1]) {
      opts.sessionTime = parseInt(argv[++i], 10);
    } else if ((a === '--output' || a === '-o') && argv[i + 1]) {
      opts.output = argv[++i];
    } else if (a.startsWith('-')) {
      // Unknown flags -- silently skip in lib mode (CLI handles exit)
      continue;
    } else {
      positional.push(a);
    }
  }

  const COMMANDS = ['analyze', 'session', 'progress', 'rate', 'click', 'serve', 'reset'];

  if (positional.length >= 1 && COMMANDS.includes(positional[0])) {
    opts.gpFile = null;
    opts.command = positional[0];
    opts.commandArgs = positional.slice(1);
  } else {
    opts.gpFile = positional[0];
    if (positional.length > 1) {
      opts.command = positional[1];
      opts.commandArgs = positional.slice(2);
    }
  }

  return opts;
}

// --- Tempo map ---

export function buildTempoMap(score) {
  const tempoChanges = [{ tick: 0, bpm: score.tempo }];
  for (const masterBar of score.masterBars) {
    if (masterBar.tempoAutomation) {
      tempoChanges.push({ tick: masterBar.start, bpm: masterBar.tempoAutomation.value });
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

  const lastMb = score.masterBars[score.masterBars.length - 1];
  const songEndTick = lastMb.start + lastMb.calculateDuration();
  const songDurationMs = tickToMs(songEndTick);

  return { tempoChanges, tickToMs, songDurationMs };
}

// --- Section markers ---

export function extractSections(score) {
  const sections = [];
  for (let i = 0; i < score.masterBars.length; i++) {
    const mb = score.masterBars[i];
    if (!mb.section) continue;
    const text = (mb.section.text || mb.section.marker || '').trim();
    if (text) sections.push({ barIndex: i, barNumber: i + 1, text });
  }
  return sections;
}

// --- Bar feature extraction ---

export function emptyFeatures(barIdx, timeSigNum) {
  return {
    barIndex: barIdx,
    barNumber: barIdx + 1,
    noteDensity: 0,
    stringCrossings: 0,
    fretSpan: 0,
    positionShifts: 0,
    techniqueScore: 0,
    rhythmScore: 0,
    techniques: [],
    noteCount: 0,
    isEmpty: true,
  };
}

export function extractBarFeatures(score, trackIndex) {
  const track = score.tracks[trackIndex];
  const features = [];

  for (let barIdx = 0; barIdx < score.masterBars.length; barIdx++) {
    const masterBar = score.masterBars[barIdx];
    const bar = track.staves[0]?.bars[barIdx];
    const timeSigNum = masterBar.timeSignatureNumerator;

    if (!bar) {
      features.push(emptyFeatures(barIdx, timeSigNum));
      continue;
    }

    const allBeats = [];
    for (const voice of bar.voices) {
      if (!voice || voice.isEmpty) continue;
      for (const beat of voice.beats) {
        if (!beat.isEmpty && !beat.isRest) {
          allBeats.push(beat);
        }
      }
    }

    if (allBeats.length === 0) {
      features.push(emptyFeatures(barIdx, timeSigNum));
      continue;
    }

    let noteCount = 0;
    for (const beat of allBeats) {
      noteCount += beat.notes.length;
    }
    const noteDensity = noteCount / Math.max(1, timeSigNum);

    let stringCrossings = 0;
    let prevString = null;
    for (const beat of allBeats) {
      for (const note of beat.notes) {
        if (prevString !== null && note.string !== prevString) {
          stringCrossings++;
        }
        prevString = note.string;
      }
    }

    const allFrets = [];
    for (const beat of allBeats) {
      for (const note of beat.notes) {
        if (!note.isDead && note.fret >= 0) allFrets.push(note.fret);
      }
    }
    const fretSpan = allFrets.length > 0
      ? Math.max(...allFrets) - Math.min(...allFrets) : 0;

    let positionShifts = 0;
    let prevAvgFret = null;
    for (const beat of allBeats) {
      const frets = beat.notes
        .filter(n => !n.isDead && n.fret >= 0)
        .map(n => n.fret);
      if (frets.length === 0) continue;
      const avgFret = frets.reduce((a, b) => a + b, 0) / frets.length;
      if (prevAvgFret !== null) {
        const shift = Math.abs(avgFret - prevAvgFret);
        if (shift >= 3) positionShifts += shift;
      }
      prevAvgFret = avgFret;
    }

    let techniqueScore = 0;
    const techniques = new Set();
    for (const beat of allBeats) {
      if (beat.hasTuplet) { techniqueScore += 1.5; techniques.add('tuplet'); }
      if (beat.graceType && beat.graceType !== 0) { techniqueScore += 1; techniques.add('grace'); }
      if (beat.pickStroke && beat.pickStroke !== 0) { techniqueScore += 0.5; }

      for (const note of beat.notes) {
        if (note.bendType && note.bendType !== 0) { techniqueScore += 3; techniques.add('bend'); }
        if (note.isHammerPullOrigin) { techniqueScore += 1; techniques.add('H/P'); }
        if (note.slideOutType && note.slideOutType !== 0) { techniqueScore += 1.5; techniques.add('slide'); }
        if (note.slideInType && note.slideInType !== 0) { techniqueScore += 1; techniques.add('slide'); }
        if (note.vibrato && note.vibrato !== 0) { techniqueScore += 0.5; techniques.add('vibrato'); }
        if (note.isHarmonic) { techniqueScore += 2; techniques.add('harmonic'); }
        if (note.isTrill) { techniqueScore += 2.5; techniques.add('trill'); }
        if (note.isPalmMute) { techniqueScore += 0.3; techniques.add('palm mute'); }
        if (note.isLetRing) { techniqueScore += 0.2; }
        if (note.isDead) { techniqueScore += 0.5; techniques.add('dead note'); }
        if (note.isStaccato) { techniqueScore += 0.3; }
      }
    }

    // Detect sweep picking
    const noteStrings = [];
    for (const beat of allBeats) {
      for (const note of beat.notes) {
        noteStrings.push(note.string);
      }
    }
    let sweepRun = 0;
    let sweepDir = 0;
    for (let i = 1; i < noteStrings.length; i++) {
      const diff = noteStrings[i] - noteStrings[i - 1];
      if (diff === 0) continue;
      const dir = diff > 0 ? 1 : -1;
      if (dir === sweepDir) {
        sweepRun++;
        if (sweepRun >= 3) techniques.add('sweep');
      } else {
        sweepDir = dir;
        sweepRun = 1;
      }
    }

    const durations = new Set();
    let rhythmScore = 0;
    for (const beat of allBeats) {
      durations.add(beat.duration);
      if (beat.dots > 0) rhythmScore += beat.dots * 0.5;
      if (beat.hasTuplet) rhythmScore += 2;
      if (beat.duration >= 16) rhythmScore += 1;
      if (beat.duration >= 32) rhythmScore += 2;
    }
    rhythmScore += Math.max(0, (durations.size - 1)) * 0.5;

    features.push({
      barIndex: barIdx,
      barNumber: barIdx + 1,
      noteDensity,
      stringCrossings,
      fretSpan,
      positionShifts,
      techniqueScore,
      rhythmScore,
      techniques: [...techniques],
      noteCount,
      isEmpty: false,
    });
  }

  return features;
}

// --- Difficulty scoring ---

export function sigmoid(value, median, steepness = 1) {
  return 1 / (1 + Math.exp(-steepness * (value - median)));
}

export function computeMedians(barFeatures) {
  const medians = {};
  for (const key of Object.keys(WEIGHTS)) {
    const values = barFeatures
      .filter(b => !b.isEmpty)
      .map(b => b[key])
      .sort((a, b) => a - b);
    if (values.length === 0) {
      medians[key] = 0;
    } else {
      medians[key] = values[Math.floor(values.length / 2)];
    }
  }
  return medians;
}

export function scoreDifficulty(features, medians) {
  if (features.isEmpty) return 0;
  let score = 0;
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    score += sigmoid(features[key], medians[key]) * weight;
  }
  return Math.round(score * 100);
}

// --- Pattern chunking ---

export function extractShape(bar, track) {
  if (!bar) return '';
  const notes = [];
  for (const voice of bar.voices) {
    if (!voice || voice.isEmpty) continue;
    for (const beat of voice.beats) {
      if (beat.isEmpty || beat.isRest) continue;
      for (const note of beat.notes) {
        if (!note.isDead) notes.push({ fret: note.fret, string: note.string });
      }
    }
  }
  if (notes.length === 0) return '';
  const baseFret = notes[0].fret;
  return notes.map(n => `${n.string}:${n.fret - baseFret}`).join(',');
}

export function extractRhythm(bar) {
  if (!bar) return '';
  const parts = [];
  for (const voice of bar.voices) {
    if (!voice || voice.isEmpty) continue;
    for (const beat of voice.beats) {
      parts.push(`${beat.duration}${beat.dots > 0 ? '.' : ''}${beat.hasTuplet ? 't' : ''}`);
    }
  }
  return parts.join('-');
}

export function featureDistance(a, b) {
  let sumSq = 0;
  for (const key of Object.keys(WEIGHTS)) {
    const diff = (a[key] || 0) - (b[key] || 0);
    sumSq += diff * diff;
  }
  return Math.sqrt(sumSq);
}

export function buildChunks(score, track, barFeatures, sections) {
  const maxChunkSize = 4;
  const sectionStarts = new Set(sections.map(s => s.barIndex));

  const chunks = [];
  let currentChunk = [0];

  for (let i = 1; i < barFeatures.length; i++) {
    if (sectionStarts.has(i)) {
      chunks.push(currentChunk);
      currentChunk = [i];
      continue;
    }

    if (barFeatures[i].isEmpty || barFeatures[i - 1].isEmpty) {
      chunks.push(currentChunk);
      currentChunk = [i];
      continue;
    }

    const barA = track.staves[0]?.bars[i - 1];
    const barB = track.staves[0]?.bars[i];
    const shapeA = extractShape(barA, track);
    const shapeB = extractShape(barB, track);
    const rhythmA = extractRhythm(barA);
    const rhythmB = extractRhythm(barB);
    const dist = featureDistance(barFeatures[i - 1], barFeatures[i]);

    const sameShape = shapeA === shapeB && shapeA !== '';
    const sameRhythm = rhythmA === rhythmB && rhythmA !== '';
    const similar = dist < 5;

    if ((sameShape || sameRhythm || similar) && currentChunk.length < maxChunkSize) {
      currentChunk.push(i);
    } else {
      chunks.push(currentChunk);
      currentChunk = [i];
    }
  }
  if (currentChunk.length > 0) chunks.push(currentChunk);

  return chunks.map((barIndices, idx) => {
    const difficulty = Math.max(...barIndices.map(i => barFeatures[i].difficulty || 0));
    const startBar = barIndices[0] + 1;
    const endBar = barIndices[barIndices.length - 1] + 1;

    let label = `Bars ${startBar}-${endBar}`;
    if (startBar === endBar) label = `Bar ${startBar}`;
    const section = sections.find(s => s.barIndex >= barIndices[0] && s.barIndex <= barIndices[barIndices.length - 1]);
    if (section) label = section.text;

    const allTechniques = new Set();
    for (const bi of barIndices) {
      for (const t of barFeatures[bi].techniques) allTechniques.add(t);
    }

    const allEmpty = barIndices.every(i => barFeatures[i].isEmpty);

    return {
      id: `chunk-${idx}`,
      barIndices,
      barRange: [startBar, endBar],
      difficulty,
      label,
      techniques: [...allTechniques],
      isEmpty: allEmpty,
    };
  }).filter(c => !c.isEmpty);
}

// --- Session generation ---

export function buildSession(chunks, state, baseTempo, sessionTimeMin) {
  const now = new Date();
  const totalMinutes = sessionTimeMin;

  const phaseTime = {
    isolation: Math.round(totalMinutes * 0.40),
    context: Math.round(totalMinutes * 0.30),
    interleaving: Math.round(totalMinutes * 0.20),
    runthrough: Math.round(totalMinutes * 0.10),
  };

  const isolationChunks = chunks.slice().sort((a, b) => {
    const aLevel = state.chunks[a.id]?.masteryLevel || 0;
    const bLevel = state.chunks[b.id]?.masteryLevel || 0;
    if (aLevel !== bLevel) return aLevel - bLevel;
    return b.difficulty - a.difficulty;
  });

  const priorityChunks = isolationChunks.filter(c => {
    const cs = state.chunks[c.id];
    if (!cs) return true;
    if (cs.masteryLevel >= 5) {
      if (cs.nextReview) {
        return new Date(cs.nextReview) <= now;
      }
      return false;
    }
    return true;
  });

  const maxIsolationChunks = Math.max(3, Math.floor(phaseTime.isolation / 2));
  const selectedChunks = priorityChunks.slice(0, maxIsolationChunks);

  const isolationItems = selectedChunks.map(chunk => {
    const cs = state.chunks[chunk.id] || { masteryLevel: 0 };
    const level = MASTERY_LEVELS[cs.masteryLevel] || MASTERY_LEVELS[0];
    const practiceBpm = Math.round(baseTempo * level.tempoPct);
    const tier = TEMPO_TIERS[cs.masteryLevel] || TEMPO_TIERS[0];

    const isDueReview = cs.nextReview && new Date(cs.nextReview) <= now;

    return {
      chunk,
      bpm: practiceBpm,
      tempoPct: level.tempoPct,
      reps: tier.reps,
      level: level.name,
      tierLabel: tier.label,
      isReview: isDueReview,
    };
  });

  const byPosition = selectedChunks.slice().sort((a, b) => a.barRange[0] - b.barRange[0]);
  const contextPairs = [];
  for (let i = 0; i < byPosition.length - 1; i++) {
    const a = byPosition[i];
    const b = byPosition[i + 1];
    if (b.barRange[0] - a.barRange[1] <= 2) {
      const avgLevel = Math.min(
        (state.chunks[a.id]?.masteryLevel || 0),
        (state.chunks[b.id]?.masteryLevel || 0)
      );
      const contextPct = Math.max(0.60, MASTERY_LEVELS[avgLevel].tempoPct - 0.10);
      contextPairs.push({
        chunks: [a, b],
        barRange: [a.barRange[0], b.barRange[1]],
        bpm: Math.round(baseTempo * contextPct),
        tempoPct: contextPct,
      });
    }
  }

  const interleaveCount = Math.min(3, selectedChunks.length);
  const shuffled = selectedChunks.slice().sort(() => Math.random() - 0.5);
  const interleaveChunks = shuffled.slice(0, interleaveCount);
  const interleavePct = 0.70;

  return {
    sessionNumber: state.sessionCount + 1,
    date: now.toISOString(),
    totalMinutes,
    phaseTime,
    baseTempo,
    isolation: isolationItems,
    context: contextPairs,
    interleaving: {
      chunks: interleaveChunks,
      bpm: Math.round(baseTempo * interleavePct),
      tempoPct: interleavePct,
    },
    runthrough: {
      bpm: Math.round(baseTempo * 0.60),
      tempoPct: 0.60,
    },
  };
}

// --- Audio synthesis ---

export function generateClickSample(sampleRate, frequency, durationMs, amplitude) {
  const numSamples = Math.floor((sampleRate * durationMs) / 1000);
  const samples = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const envelope = Math.exp(-t * 200);
    samples[i] = Math.sin(2 * Math.PI * frequency * t) * envelope * amplitude;
  }
  return samples;
}

export function renderClickTrack(clicks, totalDurationMs, sampleRate) {
  const totalSamples = Math.ceil((sampleRate * totalDurationMs) / 1000);
  const audio = new Float32Array(totalSamples);

  const hiClick = generateClickSample(sampleRate, 1000, 8, 0.9);
  const loClick = generateClickSample(sampleRate, 800, 6, 0.6);

  for (const click of clicks) {
    const samplePos = Math.floor((sampleRate * click.ms) / 1000);
    const sound = click.isDownbeat ? hiClick : loClick;
    for (let j = 0; j < sound.length && samplePos + j < totalSamples; j++) {
      audio[samplePos + j] += sound[j];
    }
  }
  return audio;
}
