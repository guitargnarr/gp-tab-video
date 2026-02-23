const listeners = {};

export function on(event, fn) {
  if (!listeners[event]) listeners[event] = [];
  listeners[event].push(fn);
}

export function off(event, fn) {
  if (!listeners[event]) return;
  listeners[event] = listeners[event].filter(f => f !== fn);
}

export function emit(event, data) {
  if (!listeners[event]) return;
  for (const fn of listeners[event]) fn(data);
}

const state = {
  atApi: null,
  boundsLookup: null,
  barBoundsMap: {},
  fileInfo: null,
  analyzeData: null,
  sessionData: null,
  progressData: null,
  selectedChunkId: null,
  playingChunkId: null,
  metronomeOn: false,
  repCount: 0,
  repTotal: 0,
  lastTickPos: 0,
  sectionStartTick: 0,
  nowPlayingLabel: '',
  nowPlayingBpm: 0,
  customReps: {},
  fileLoaded: false,
};

export default state;
