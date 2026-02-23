import state, { emit } from './state.mjs';
import { CHUNK_COLORS } from './constants.mjs';

export function initAlphaTab() {
  const container = document.getElementById('alphaTab');
  const settings = new alphaTab.Settings();
  settings.core.fontDirectory = '/node_modules/@coderline/alphatab/dist/font/';
  settings.player.enablePlayer = true;
  settings.player.enableCursor = true;
  settings.player.enableUserInteraction = true;
  settings.player.scrollMode = alphaTab.ScrollMode.Continuous;
  settings.player.scrollSpeed = 300;
  settings.player.scrollElement = container;
  settings.player.soundFont = '/node_modules/@coderline/alphatab/dist/soundfont/sonivox.sf2';
  settings.display.layoutMode = alphaTab.LayoutMode.Page;

  const res = settings.display.resources;
  res.mainGlyphColor = new alphaTab.model.Color(255, 255, 255, 255);
  res.staffLineColor = new alphaTab.model.Color(180, 180, 180, 255);
  res.barSeparatorColor = new alphaTab.model.Color(100, 100, 100, 255);
  res.barNumberColor = new alphaTab.model.Color(180, 180, 180, 255);
  res.secondaryGlyphColor = new alphaTab.model.Color(180, 180, 180, 200);
  res.scoreInfoColor = new alphaTab.model.Color(255, 255, 255, 255);

  state.atApi = new alphaTab.AlphaTabApi(container, settings);

  state.atApi.scoreLoaded.on((score) => {
    for (const track of score.tracks) {
      for (const staff of track.staves) {
        staff.showTablature = true;
        staff.showStandardNotation = false;
      }
    }
    const trackIdx = state.fileInfo ? state.fileInfo.activeTrack : 0;
    const activeTrack = score.tracks[trackIdx] || score.tracks[0];
    state.atApi.renderTracks([activeTrack]);
  });

  state.atApi.renderFinished.on(() => {
    state.boundsLookup = state.atApi.renderer.boundsLookup;
    buildBarBoundsMap();
    renderChunkOverlays();
  });

  state.atApi.playerStateChanged.on((e) => {
    const playBtn = document.getElementById('playBtn');
    if (e.state === alphaTab.synth.PlayerState.Playing) {
      playBtn.textContent = 'Pause';
    } else {
      playBtn.textContent = 'Play';
      // Only handle UI cleanup for external stops (e.g. alphaTab reaching end of range).
      // Do NOT emit playback-stopped here -- stopSectionPlayback is the single emitter,
      // preventing double-emission that corrupts the session runner state machine.
      if (e.stopped && state.playingChunkId) {
        state.playingChunkId = null;
        document.querySelectorAll('.btn-click.playing, .btn-click-small.playing').forEach(el => {
          el.classList.remove('playing');
        });
        document.getElementById('nowPlaying').textContent = '';
      }
    }
  });

  let lastBeatNum = -1;
  let beatDotTimer = null;
  const beatDot = document.getElementById('beatDot');
  state.atApi.playerPositionChanged.on((e) => {
    const tick = e.currentTick;

    const beatNum = Math.floor(tick / 960);
    if (beatNum !== lastBeatNum) {
      lastBeatNum = beatNum;
      if (state.metronomeOn && beatDot) {
        beatDot.style.background = '#ff5555';
        clearTimeout(beatDotTimer);
        beatDotTimer = setTimeout(() => { beatDot.style.background = '#333'; }, 120);
      }
    }

    if (!state.playingChunkId || state.repTotal <= 0) { state.lastTickPos = tick; return; }
    if (state.lastTickPos > state.sectionStartTick + 500 && tick <= state.sectionStartTick + 100) {
      state.repCount++;
      emit('rep-completed', { repCount: state.repCount, repTotal: state.repTotal });
    }
    state.lastTickPos = tick;
  });

  state.atApi.playerReady.on(() => {
    document.getElementById('playBtn').disabled = false;
    document.getElementById('stopBtn').disabled = false;
  });
}

export function loadAlphaTabFile() {
  fetch('/api/file')
    .then(r => r.arrayBuffer())
    .then(buf => state.atApi.load(new Uint8Array(buf)));
}

export function buildBarBoundsMap() {
  state.barBoundsMap = {};
  if (!state.boundsLookup) return;

  if (state.boundsLookup.staffSystems) {
    for (const system of state.boundsLookup.staffSystems) {
      for (const masterBar of system.bars) {
        const idx = masterBar.index;
        const b = masterBar.visualBounds;
        if (typeof idx === 'number' && b) {
          state.barBoundsMap[idx] = { x: b.x, y: b.y, w: b.w, h: b.h };
        }
      }
    }
  }
  console.log(`[Practice] barBoundsMap: ${Object.keys(state.barBoundsMap).length} bars`);
}

export function renderChunkOverlays() {
  document.querySelectorAll('.chunk-overlay').forEach(el => el.remove());
  if (!state.analyzeData || Object.keys(state.barBoundsMap).length === 0) return;

  const surface = document.querySelector('#alphaTab .at-surface');
  if (!surface) return;

  for (let i = 0; i < state.analyzeData.chunks.length; i++) {
    const chunk = state.analyzeData.chunks[i];
    const color = CHUNK_COLORS[i % CHUNK_COLORS.length];

    for (const barIdx of chunk.barIndices) {
      const b = state.barBoundsMap[barIdx];
      if (!b) continue;
      const ov = document.createElement('div');
      ov.className = 'chunk-overlay' + (chunk.id === state.selectedChunkId ? ' active' : '');
      ov.dataset.chunkId = chunk.id;
      ov.style.cssText = `left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;background:${color}`;
      surface.appendChild(ov);
    }
  }
}

export function highlightChunk(chunkId) {
  const stopSectionPlayback = _stopSectionPlayback;

  if (state.playingChunkId && state.playingChunkId !== chunkId) {
    stopSectionPlayback();
  }

  if (state.selectedChunkId === chunkId) {
    state.selectedChunkId = null;
  } else {
    state.selectedChunkId = chunkId;
  }

  document.querySelectorAll('.chunk-overlay').forEach(el => {
    el.classList.toggle('active', el.dataset.chunkId === state.selectedChunkId);
  });
  document.querySelectorAll('.session-item, .chunk-row').forEach(el => {
    el.classList.toggle('selected', el.dataset.chunkId === state.selectedChunkId);
  });

  if (!state.selectedChunkId) return;
  const chunk = state.analyzeData.chunks.find(c => c.id === state.selectedChunkId);
  if (!chunk) return;

  const firstBarIdx = chunk.barIndices[0];

  if (state.atApi && state.atApi.score && state.atApi.score.masterBars[firstBarIdx]) {
    const tick = state.atApi.score.masterBars[firstBarIdx].start;
    state.atApi.tickPosition = tick;
  }

  const b = state.barBoundsMap[firstBarIdx];
  if (b) {
    document.getElementById('alphaTab').scrollTo({
      top: Math.max(0, b.y - 60),
      behavior: 'smooth'
    });
  }
}

// Break circular dependency: playback.mjs imports from this module,
// and highlightChunk needs stopSectionPlayback. We use a setter pattern.
let _stopSectionPlayback = () => {};
export function setStopSectionPlayback(fn) { _stopSectionPlayback = fn; }
