import { describe, it, expect } from 'vitest';
import {
  WEIGHTS, MASTERY_LEVELS, TEMPO_TIERS,
  parseArgs, buildTempoMap, extractSections,
  extractBarFeatures, emptyFeatures,
  sigmoid, computeMedians, scoreDifficulty,
  extractShape, extractRhythm, featureDistance, buildChunks,
  buildSession,
  generateClickSample, renderClickTrack,
} from '../src/practice-engine.mjs';

// ---------------------------------------------------------------------------
// Test helpers -- minimal mock objects that mimic alphaTab's score model
// ---------------------------------------------------------------------------

function mockNote(fret, string, extras = {}) {
  return {
    fret, string,
    isDead: false, isHammerPullOrigin: false, isHarmonic: false,
    isTrill: false, isPalmMute: false, isLetRing: false,
    isStaccato: false,
    bendType: 0, slideOutType: 0, slideInType: 0, vibrato: 0,
    ...extras,
  };
}

function mockBeat(notes, duration = 4, extras = {}) {
  return {
    notes, duration,
    isEmpty: false, isRest: false,
    dots: 0, hasTuplet: false,
    graceType: 0, pickStroke: 0,
    ...extras,
  };
}

function mockVoice(beats) {
  return { beats, isEmpty: beats.length === 0 };
}

function mockBar(voices) {
  return { voices };
}

function mockMasterBar(barIdx, timeSigNum = 4, extras = {}) {
  const ticksPerBar = 960 * timeSigNum;
  return {
    start: barIdx * ticksPerBar,
    timeSignatureNumerator: timeSigNum,
    timeSignatureDenominator: 4,
    section: null,
    tempoAutomation: null,
    calculateDuration() { return ticksPerBar; },
    ...extras,
  };
}

function mockScore(bars, tempo = 120) {
  // bars: array of { beats: [...], timeSig?, section? }
  const masterBars = bars.map((b, i) => mockMasterBar(i, b.timeSig || 4, {
    section: b.section || null,
  }));

  const trackBars = bars.map(b => {
    if (b.empty) return mockBar([mockVoice([])]);
    return mockBar([mockVoice(b.beats || [])]);
  });

  return {
    tempo,
    masterBars,
    tracks: [{
      staves: [{ bars: trackBars }],
    }],
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('Constants', () => {
  it('WEIGHTS sum to 1.0', () => {
    const sum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0);
  });

  it('MASTERY_LEVELS has 6 levels with increasing intervals', () => {
    expect(MASTERY_LEVELS).toHaveLength(6);
    for (let i = 1; i < MASTERY_LEVELS.length; i++) {
      expect(MASTERY_LEVELS[i].interval).toBeGreaterThanOrEqual(MASTERY_LEVELS[i - 1].interval);
    }
  });

  it('MASTERY_LEVELS tempoPct increases monotonically', () => {
    for (let i = 1; i < MASTERY_LEVELS.length; i++) {
      expect(MASTERY_LEVELS[i].tempoPct).toBeGreaterThanOrEqual(MASTERY_LEVELS[i - 1].tempoPct);
    }
  });

  it('TEMPO_TIERS has 5 tiers', () => {
    expect(TEMPO_TIERS).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe('parseArgs', () => {
  it('parses file + command', () => {
    const opts = parseArgs(['song.gp5', 'analyze']);
    expect(opts.gpFile).toBe('song.gp5');
    expect(opts.command).toBe('analyze');
  });

  it('defaults to analyze when only file given', () => {
    const opts = parseArgs(['song.gp5']);
    expect(opts.command).toBe('analyze');
  });

  it('handles command-only (no file)', () => {
    const opts = parseArgs(['serve']);
    expect(opts.gpFile).toBeNull();
    expect(opts.command).toBe('serve');
  });

  it('parses --track option', () => {
    const opts = parseArgs(['song.gp5', 'analyze', '--track', '2']);
    expect(opts.track).toBe(2);
  });

  it('parses --session-time option', () => {
    const opts = parseArgs(['song.gp5', 'session', '--session-time', '45']);
    expect(opts.sessionTime).toBe(45);
  });

  it('parses -o output shorthand', () => {
    const opts = parseArgs(['song.gp5', '-o', '/tmp/out']);
    expect(opts.output).toBe('/tmp/out');
  });

  it('passes extra args as commandArgs', () => {
    const opts = parseArgs(['song.gp5', 'rate', 'chunk-0:5', 'chunk-1:3']);
    expect(opts.command).toBe('rate');
    expect(opts.commandArgs).toEqual(['chunk-0:5', 'chunk-1:3']);
  });

  it('serve with port in commandArgs', () => {
    const opts = parseArgs(['serve', '3002']);
    expect(opts.command).toBe('serve');
    expect(opts.commandArgs).toEqual(['3002']);
  });
});

// ---------------------------------------------------------------------------
// sigmoid
// ---------------------------------------------------------------------------

describe('sigmoid', () => {
  it('returns 0.5 when value equals median', () => {
    expect(sigmoid(5, 5)).toBeCloseTo(0.5);
  });

  it('returns > 0.5 when value > median', () => {
    expect(sigmoid(10, 5)).toBeGreaterThan(0.5);
  });

  it('returns < 0.5 when value < median', () => {
    expect(sigmoid(0, 5)).toBeLessThan(0.5);
  });

  it('approaches 1 for very large values', () => {
    expect(sigmoid(100, 5)).toBeGreaterThan(0.99);
  });

  it('approaches 0 for very negative values', () => {
    expect(sigmoid(-100, 5)).toBeLessThan(0.01);
  });

  it('respects steepness parameter', () => {
    const gentle = sigmoid(6, 5, 0.5);
    const steep = sigmoid(6, 5, 5);
    // Steeper curve should be further from 0.5
    expect(Math.abs(steep - 0.5)).toBeGreaterThan(Math.abs(gentle - 0.5));
  });
});

// ---------------------------------------------------------------------------
// computeMedians
// ---------------------------------------------------------------------------

describe('computeMedians', () => {
  it('returns 0 for all keys when no non-empty features', () => {
    const features = [emptyFeatures(0, 4), emptyFeatures(1, 4)];
    const medians = computeMedians(features);
    for (const key of Object.keys(WEIGHTS)) {
      expect(medians[key]).toBe(0);
    }
  });

  it('computes correct median for odd-count features', () => {
    const features = [
      { noteDensity: 1, stringCrossings: 0, fretSpan: 0, positionShifts: 0, techniqueScore: 0, rhythmScore: 0, isEmpty: false },
      { noteDensity: 3, stringCrossings: 0, fretSpan: 0, positionShifts: 0, techniqueScore: 0, rhythmScore: 0, isEmpty: false },
      { noteDensity: 5, stringCrossings: 0, fretSpan: 0, positionShifts: 0, techniqueScore: 0, rhythmScore: 0, isEmpty: false },
    ];
    const medians = computeMedians(features);
    expect(medians.noteDensity).toBe(3);
  });

  it('ignores empty features in median calculation', () => {
    const features = [
      { noteDensity: 10, stringCrossings: 0, fretSpan: 0, positionShifts: 0, techniqueScore: 0, rhythmScore: 0, isEmpty: false },
      { noteDensity: 0, stringCrossings: 0, fretSpan: 0, positionShifts: 0, techniqueScore: 0, rhythmScore: 0, isEmpty: true },
      { noteDensity: 20, stringCrossings: 0, fretSpan: 0, positionShifts: 0, techniqueScore: 0, rhythmScore: 0, isEmpty: false },
    ];
    const medians = computeMedians(features);
    // Only [10, 20] non-empty => median = 20 (floor of length/2 = 1 => index 1)
    expect(medians.noteDensity).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// scoreDifficulty
// ---------------------------------------------------------------------------

describe('scoreDifficulty', () => {
  it('returns 0 for empty features', () => {
    const features = emptyFeatures(0, 4);
    const medians = { noteDensity: 5, stringCrossings: 3, fretSpan: 4, positionShifts: 2, techniqueScore: 3, rhythmScore: 2 };
    expect(scoreDifficulty(features, medians)).toBe(0);
  });

  it('returns 50 when all features equal medians', () => {
    const medians = { noteDensity: 5, stringCrossings: 3, fretSpan: 4, positionShifts: 2, techniqueScore: 3, rhythmScore: 2 };
    const features = { ...medians, isEmpty: false };
    expect(scoreDifficulty(features, medians)).toBe(50);
  });

  it('returns > 50 when all features exceed medians', () => {
    const medians = { noteDensity: 5, stringCrossings: 3, fretSpan: 4, positionShifts: 2, techniqueScore: 3, rhythmScore: 2 };
    const features = {
      noteDensity: 20, stringCrossings: 15, fretSpan: 20,
      positionShifts: 15, techniqueScore: 20, rhythmScore: 15,
      isEmpty: false,
    };
    expect(scoreDifficulty(features, medians)).toBeGreaterThan(50);
  });

  it('returns between 0 and 100', () => {
    const medians = { noteDensity: 5, stringCrossings: 3, fretSpan: 4, positionShifts: 2, techniqueScore: 3, rhythmScore: 2 };
    const features = { noteDensity: 0, stringCrossings: 0, fretSpan: 0, positionShifts: 0, techniqueScore: 0, rhythmScore: 0, isEmpty: false };
    const score = scoreDifficulty(features, medians);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// emptyFeatures
// ---------------------------------------------------------------------------

describe('emptyFeatures', () => {
  it('returns zeroed features with correct bar index', () => {
    const f = emptyFeatures(3, 4);
    expect(f.barIndex).toBe(3);
    expect(f.barNumber).toBe(4);
    expect(f.isEmpty).toBe(true);
    expect(f.noteDensity).toBe(0);
    expect(f.techniques).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// featureDistance
// ---------------------------------------------------------------------------

describe('featureDistance', () => {
  it('returns 0 for identical features', () => {
    const f = { noteDensity: 5, stringCrossings: 3, fretSpan: 4, positionShifts: 2, techniqueScore: 3, rhythmScore: 2 };
    expect(featureDistance(f, f)).toBe(0);
  });

  it('returns correct Euclidean distance', () => {
    const a = { noteDensity: 0, stringCrossings: 0, fretSpan: 0, positionShifts: 0, techniqueScore: 0, rhythmScore: 0 };
    const b = { noteDensity: 3, stringCrossings: 4, fretSpan: 0, positionShifts: 0, techniqueScore: 0, rhythmScore: 0 };
    // sqrt(9 + 16) = 5
    expect(featureDistance(a, b)).toBeCloseTo(5);
  });

  it('handles missing keys gracefully (defaults to 0)', () => {
    const a = { noteDensity: 5 };
    const b = {};
    // Should not throw
    expect(typeof featureDistance(a, b)).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// extractShape / extractRhythm
// ---------------------------------------------------------------------------

describe('extractShape', () => {
  it('returns empty string for null bar', () => {
    expect(extractShape(null)).toBe('');
  });

  it('returns empty string for bar with no notes', () => {
    const bar = mockBar([mockVoice([mockBeat([], 4, { isEmpty: true })])]);
    expect(extractShape(bar)).toBe('');
  });

  it('encodes fret+string relative to first note', () => {
    const bar = mockBar([mockVoice([
      mockBeat([mockNote(5, 3)]),
      mockBeat([mockNote(7, 3)]),
      mockBeat([mockNote(5, 2)]),
    ])]);
    // Base fret = 5, so: 3:0, 3:2, 2:0
    expect(extractShape(bar)).toBe('3:0,3:2,2:0');
  });
});

describe('extractRhythm', () => {
  it('returns empty string for null bar', () => {
    expect(extractRhythm(null)).toBe('');
  });

  it('encodes duration with dot and tuplet flags', () => {
    const bar = mockBar([mockVoice([
      mockBeat([mockNote(5, 3)], 4),
      mockBeat([mockNote(7, 3)], 8, { dots: 1 }),
      mockBeat([mockNote(5, 2)], 16, { hasTuplet: true }),
    ])]);
    expect(extractRhythm(bar)).toBe('4-8.-16t');
  });
});

// ---------------------------------------------------------------------------
// extractBarFeatures (with mock score)
// ---------------------------------------------------------------------------

describe('extractBarFeatures', () => {
  it('returns empty features for bar with no notes', () => {
    const score = mockScore([{ empty: true }]);
    const features = extractBarFeatures(score, 0);
    expect(features).toHaveLength(1);
    expect(features[0].isEmpty).toBe(true);
  });

  it('computes note density correctly', () => {
    const score = mockScore([{
      beats: [
        mockBeat([mockNote(5, 3), mockNote(7, 2)]),  // 2 notes
        mockBeat([mockNote(5, 3)]),                    // 1 note
        mockBeat([mockNote(7, 3)]),                    // 1 note
        mockBeat([mockNote(9, 3)]),                    // 1 note
      ],
      timeSig: 4,
    }]);
    const features = extractBarFeatures(score, 0);
    // 5 notes / 4 time sig = 1.25
    expect(features[0].noteDensity).toBe(1.25);
    expect(features[0].noteCount).toBe(5);
  });

  it('counts string crossings', () => {
    const score = mockScore([{
      beats: [
        mockBeat([mockNote(5, 3)]),  // string 3
        mockBeat([mockNote(5, 2)]),  // string 2 -> crossing
        mockBeat([mockNote(5, 2)]),  // string 2 -> no crossing
        mockBeat([mockNote(5, 4)]),  // string 4 -> crossing
      ],
    }]);
    const features = extractBarFeatures(score, 0);
    expect(features[0].stringCrossings).toBe(2);
  });

  it('computes fret span', () => {
    const score = mockScore([{
      beats: [
        mockBeat([mockNote(3, 1)]),
        mockBeat([mockNote(12, 1)]),
        mockBeat([mockNote(7, 1)]),
        mockBeat([mockNote(5, 1)]),
      ],
    }]);
    const features = extractBarFeatures(score, 0);
    expect(features[0].fretSpan).toBe(9);  // 12 - 3
  });

  it('detects hammer-on technique', () => {
    const score = mockScore([{
      beats: [
        mockBeat([mockNote(5, 3, { isHammerPullOrigin: true })]),
        mockBeat([mockNote(7, 3)]),
        mockBeat([mockNote(5, 3)]),
        mockBeat([mockNote(7, 3)]),
      ],
    }]);
    const features = extractBarFeatures(score, 0);
    expect(features[0].techniques).toContain('H/P');
    expect(features[0].techniqueScore).toBeGreaterThan(0);
  });

  it('detects bend technique', () => {
    const score = mockScore([{
      beats: [
        mockBeat([mockNote(7, 2, { bendType: 1 })]),
        mockBeat([mockNote(5, 3)]),
        mockBeat([mockNote(7, 3)]),
        mockBeat([mockNote(5, 3)]),
      ],
    }]);
    const features = extractBarFeatures(score, 0);
    expect(features[0].techniques).toContain('bend');
  });

  it('detects sweep picking (3+ same-direction string crossings)', () => {
    const score = mockScore([{
      beats: [
        mockBeat([mockNote(5, 0)]),  // string 0
        mockBeat([mockNote(5, 1)]),  // string 1 -> up
        mockBeat([mockNote(5, 2)]),  // string 2 -> up
        mockBeat([mockNote(5, 3)]),  // string 3 -> up (3 consecutive = sweep)
      ],
    }]);
    const features = extractBarFeatures(score, 0);
    expect(features[0].techniques).toContain('sweep');
  });

  it('scores rhythm complexity for mixed durations', () => {
    const score = mockScore([{
      beats: [
        mockBeat([mockNote(5, 3)], 4),
        mockBeat([mockNote(7, 3)], 8),
        mockBeat([mockNote(5, 3)], 16),
        mockBeat([mockNote(7, 3)], 4),
      ],
    }]);
    const features = extractBarFeatures(score, 0);
    // 3 unique durations -> +1.0 from size, plus 16th note +1
    expect(features[0].rhythmScore).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// extractSections
// ---------------------------------------------------------------------------

describe('extractSections', () => {
  it('returns empty array when no sections', () => {
    const score = mockScore([{}, {}, {}]);
    expect(extractSections(score)).toEqual([]);
  });

  it('extracts section text and bar index', () => {
    const score = mockScore([
      { section: { text: 'Intro' } },
      {},
      { section: { text: 'Verse' } },
    ]);
    const sections = extractSections(score);
    expect(sections).toHaveLength(2);
    expect(sections[0]).toEqual({ barIndex: 0, barNumber: 1, text: 'Intro' });
    expect(sections[1]).toEqual({ barIndex: 2, barNumber: 3, text: 'Verse' });
  });

  it('falls back to marker field', () => {
    const score = mockScore([
      { section: { marker: 'Solo' } },
    ]);
    const sections = extractSections(score);
    expect(sections[0].text).toBe('Solo');
  });
});

// ---------------------------------------------------------------------------
// buildTempoMap
// ---------------------------------------------------------------------------

describe('buildTempoMap', () => {
  it('computes correct duration for constant-tempo score', () => {
    // 4 bars of 4/4 at 120 BPM = 4 * 4 beats * 500ms = 8000ms
    const score = mockScore([{}, {}, {}, {}], 120);
    const { songDurationMs, tickToMs } = buildTempoMap(score);
    expect(songDurationMs).toBeCloseTo(8000, 0);
  });

  it('tickToMs returns 0 for tick 0', () => {
    const score = mockScore([{}], 120);
    const { tickToMs } = buildTempoMap(score);
    expect(tickToMs(0)).toBe(0);
  });

  it('tickToMs returns correct ms for one quarter note at 120 BPM', () => {
    const score = mockScore([{}], 120);
    const { tickToMs } = buildTempoMap(score);
    // 960 ticks = 1 quarter note at 120 BPM = 500ms
    expect(tickToMs(960)).toBeCloseTo(500, 0);
  });

  it('handles tempo change mid-song', () => {
    const score = mockScore([{}, {}], 120);
    // Add tempo change at bar 2 (tick 3840) to 60 BPM
    score.masterBars[1].tempoAutomation = { value: 60 };
    const { tickToMs } = buildTempoMap(score);
    // First bar (ticks 0-3840) at 120 BPM = 2000ms
    // Second bar (ticks 3840-7680) at 60 BPM = 4000ms
    // Total tick 7680 should be 6000ms
    expect(tickToMs(7680)).toBeCloseTo(6000, 0);
  });
});

// ---------------------------------------------------------------------------
// buildChunks
// ---------------------------------------------------------------------------

describe('buildChunks', () => {
  it('groups identical bars into one chunk', () => {
    const beats = [
      mockBeat([mockNote(5, 3)]),
      mockBeat([mockNote(7, 3)]),
      mockBeat([mockNote(5, 3)]),
      mockBeat([mockNote(7, 3)]),
    ];
    const score = mockScore([
      { beats }, { beats }, { beats }, { beats },
    ]);
    const features = extractBarFeatures(score, 0);
    const medians = computeMedians(features);
    features.forEach(f => f.difficulty = scoreDifficulty(f, medians));

    const chunks = buildChunks(score, score.tracks[0], features, []);
    // All 4 identical bars should be in 1 chunk (max chunk size = 4)
    expect(chunks).toHaveLength(1);
    expect(chunks[0].barIndices).toEqual([0, 1, 2, 3]);
  });

  it('breaks chunks at section boundaries', () => {
    const beats = [mockBeat([mockNote(5, 3)])];
    const score = mockScore([
      { beats, section: { text: 'Intro' } },
      { beats },
      { beats, section: { text: 'Verse' } },
      { beats },
    ]);
    const features = extractBarFeatures(score, 0);
    const medians = computeMedians(features);
    features.forEach(f => f.difficulty = scoreDifficulty(f, medians));
    const sections = extractSections(score);

    const chunks = buildChunks(score, score.tracks[0], features, sections);
    // Should split at bar 2 (section 'Verse')
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0].label).toBe('Intro');
  });

  it('filters out all-empty chunks', () => {
    const score = mockScore([
      { empty: true },
      { beats: [mockBeat([mockNote(5, 3)])] },
    ]);
    const features = extractBarFeatures(score, 0);
    const medians = computeMedians(features);
    features.forEach(f => f.difficulty = scoreDifficulty(f, medians));

    const chunks = buildChunks(score, score.tracks[0], features, []);
    // Empty bar chunk should be filtered out
    const emptyChunks = chunks.filter(c => c.isEmpty);
    expect(emptyChunks).toHaveLength(0);
  });

  it('enforces max chunk size of 4', () => {
    const beats = [mockBeat([mockNote(5, 3)])];
    const score = mockScore([
      { beats }, { beats }, { beats }, { beats },
      { beats }, { beats }, { beats }, { beats },
    ]);
    const features = extractBarFeatures(score, 0);
    const medians = computeMedians(features);
    features.forEach(f => f.difficulty = scoreDifficulty(f, medians));

    const chunks = buildChunks(score, score.tracks[0], features, []);
    for (const chunk of chunks) {
      expect(chunk.barIndices.length).toBeLessThanOrEqual(4);
    }
  });
});

// ---------------------------------------------------------------------------
// buildSession
// ---------------------------------------------------------------------------

describe('buildSession', () => {
  function makeChunksAndState(count) {
    const chunks = Array.from({ length: count }, (_, i) => ({
      id: `chunk-${i}`,
      barRange: [i * 4 + 1, i * 4 + 4],
      difficulty: 50 + i * 5,
      techniques: [],
    }));
    const state = {
      sessionCount: 0,
      chunks: {},
    };
    for (const c of chunks) {
      state.chunks[c.id] = {
        barRange: c.barRange,
        difficulty: c.difficulty,
        masteryLevel: 0,
        lastPracticed: null,
        nextReview: null,
        history: [],
      };
    }
    return { chunks, state };
  }

  it('returns all 4 phases', () => {
    const { chunks, state } = makeChunksAndState(5);
    const session = buildSession(chunks, state, 120, 30);
    expect(session).toHaveProperty('isolation');
    expect(session).toHaveProperty('context');
    expect(session).toHaveProperty('interleaving');
    expect(session).toHaveProperty('runthrough');
  });

  it('phase time allocations sum to total minutes', () => {
    const { chunks, state } = makeChunksAndState(5);
    const session = buildSession(chunks, state, 120, 30);
    const { isolation, context, interleaving, runthrough } = session.phaseTime;
    expect(isolation + context + interleaving + runthrough).toBe(30);
  });

  it('isolation items have correct BPM for mastery level 0', () => {
    const { chunks, state } = makeChunksAndState(3);
    const session = buildSession(chunks, state, 120, 30);
    // Level 0 = 40% of base tempo
    for (const item of session.isolation) {
      expect(item.bpm).toBe(Math.round(120 * 0.40));
      expect(item.level).toBe('New');
    }
  });

  it('excludes mastered chunks not due for review', () => {
    const { chunks, state } = makeChunksAndState(3);
    // Mark all as mastered with future review date
    for (const id of Object.keys(state.chunks)) {
      state.chunks[id].masteryLevel = 5;
      state.chunks[id].nextReview = new Date(Date.now() + 86400000 * 30).toISOString();
    }
    const session = buildSession(chunks, state, 120, 30);
    expect(session.isolation).toHaveLength(0);
  });

  it('runthrough BPM is 60% of base tempo', () => {
    const { chunks, state } = makeChunksAndState(3);
    const session = buildSession(chunks, state, 100, 30);
    expect(session.runthrough.bpm).toBe(60);
    expect(session.runthrough.tempoPct).toBe(0.60);
  });
});

// ---------------------------------------------------------------------------
// generateClickSample
// ---------------------------------------------------------------------------

describe('generateClickSample', () => {
  it('returns Float32Array of correct length', () => {
    const samples = generateClickSample(44100, 1000, 10, 0.9);
    // 44100 * 10 / 1000 = 441 samples
    expect(samples).toBeInstanceOf(Float32Array);
    expect(samples.length).toBe(441);
  });

  it('first sample is near zero (sine starts at 0)', () => {
    const samples = generateClickSample(44100, 1000, 10, 0.9);
    expect(Math.abs(samples[0])).toBeLessThan(0.01);
  });

  it('amplitude decays over time', () => {
    const samples = generateClickSample(44100, 1000, 10, 0.9);
    const firstPeak = Math.max(...Array.from(samples.slice(0, 50)));
    const lastPeak = Math.max(...Array.from(samples.slice(-50)));
    expect(firstPeak).toBeGreaterThan(lastPeak);
  });

  it('respects amplitude parameter', () => {
    const loud = generateClickSample(44100, 1000, 10, 0.9);
    const quiet = generateClickSample(44100, 1000, 10, 0.1);
    const loudMax = Math.max(...Array.from(loud).map(Math.abs));
    const quietMax = Math.max(...Array.from(quiet).map(Math.abs));
    expect(loudMax).toBeGreaterThan(quietMax);
  });
});

// ---------------------------------------------------------------------------
// renderClickTrack
// ---------------------------------------------------------------------------

describe('renderClickTrack', () => {
  it('returns Float32Array of correct length', () => {
    const audio = renderClickTrack([], 1000, 44100);
    expect(audio).toBeInstanceOf(Float32Array);
    expect(audio.length).toBe(Math.ceil(44100 * 1000 / 1000));
  });

  it('is silent when no clicks', () => {
    const audio = renderClickTrack([], 1000, 44100);
    const maxVal = Math.max(...Array.from(audio).map(Math.abs));
    expect(maxVal).toBe(0);
  });

  it('has audio at click positions', () => {
    const clicks = [
      { ms: 0, isDownbeat: true },
      { ms: 500, isDownbeat: false },
    ];
    const audio = renderClickTrack(clicks, 1000, 44100);
    // Samples around position 0 should be non-zero
    const nearStart = Math.max(...Array.from(audio.slice(0, 100)).map(Math.abs));
    expect(nearStart).toBeGreaterThan(0);
    // Samples around position 22050 (500ms) should be non-zero
    const nearMiddle = Math.max(...Array.from(audio.slice(22000, 22200)).map(Math.abs));
    expect(nearMiddle).toBeGreaterThan(0);
  });

  it('downbeat clicks are louder than offbeat clicks', () => {
    const downbeat = renderClickTrack([{ ms: 0, isDownbeat: true }], 100, 44100);
    const offbeat = renderClickTrack([{ ms: 0, isDownbeat: false }], 100, 44100);
    const downMax = Math.max(...Array.from(downbeat).map(Math.abs));
    const offMax = Math.max(...Array.from(offbeat).map(Math.abs));
    expect(downMax).toBeGreaterThan(offMax);
  });
});

// ---------------------------------------------------------------------------
// detectTuning (from tuning.mjs)
// ---------------------------------------------------------------------------

import { detectTuning } from '../src/tuning.mjs';

describe('detectTuning', () => {
  it('detects standard tuning', () => {
    // alphaTab order: high to low (e4=64, B3=59, G3=55, D3=50, A2=45, E2=40)
    const result = detectTuning([64, 59, 55, 50, 45, 40], 6);
    expect(result.name).toBe('E Standard');
  });

  it('detects Drop D tuning', () => {
    const result = detectTuning([64, 59, 55, 50, 45, 38], 6);
    expect(result.name).toBe('Drop D');
  });

  it('handles custom tuning gracefully', () => {
    const result = detectTuning([64, 59, 55, 50, 45, 30], 6);
    expect(result).toHaveProperty('name');
    expect(result).toHaveProperty('notes');
  });
});
