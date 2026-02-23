import state, { on, emit } from './state.mjs';
import { setStopSectionPlayback } from './alphatab-manager.mjs';
import { chunkLabel } from './ui.mjs';

// Update rep display when rep-completed fires (from alphatab-manager)
on('rep-completed', () => updateRepDisplay());

export function updateRepDisplay() {
  const el = document.getElementById('nowPlaying');
  if (!el || !state.playingChunkId) return;
  let text = state.nowPlayingLabel;
  if (state.nowPlayingBpm > 0) text += ` · ${state.nowPlayingBpm} BPM`;
  if (state.repTotal > 1) text += ` · Rep ${Math.min(state.repCount + 1, state.repTotal)}/${state.repTotal}`;
  el.textContent = text;
}

export function stopSectionPlayback() {
  if (!state.atApi) return;
  state.atApi.stop();
  state.atApi.playbackRange = null;
  state.atApi.isLooping = false;
  state.playingChunkId = null;
  state.repCount = 0;
  state.repTotal = 0;
  state.nowPlayingLabel = '';
  state.nowPlayingBpm = 0;
  document.querySelectorAll('.btn-click.playing, .btn-click-small.playing').forEach(el => {
    el.classList.remove('playing');
  });
  const np = document.getElementById('nowPlaying');
  if (np) np.textContent = '';
  emit('playback-stopped');
}

// Wire up the circular dep bridge
setStopSectionPlayback(stopSectionPlayback);

export function toggleSectionPlay(chunkId, buttonEl) {
  if (!state.atApi || !state.atApi.score) return;

  if (state.playingChunkId === chunkId) {
    if (state.atApi.playerState === alphaTab.synth.PlayerState.Playing) {
      state.atApi.pause();
    } else {
      state.atApi.play();
    }
    return;
  }

  if (state.atApi.playerState === alphaTab.synth.PlayerState.Playing) {
    state.atApi.stop();
  }
  state.playingChunkId = null;
  document.querySelectorAll('.btn-click.playing, .btn-click-small.playing').forEach(el => {
    el.classList.remove('playing');
  });

  const chunk = state.analyzeData.chunks.find(c => c.id === chunkId);
  if (!chunk) return;

  const startBarIdx = chunk.barIndices[0];
  const endBarIdx = chunk.barIndices[chunk.barIndices.length - 1];
  const startTick = state.atApi.score.masterBars[startBarIdx].start;
  const endMb = state.atApi.score.masterBars[endBarIdx];
  const endTick = endMb.start + endMb.calculateDuration() - 1;

  state.atApi.isLooping = true;
  state.atApi.playbackRange = { startTick, endTick };
  state.atApi.countInVolume = state.metronomeOn ? 1.0 : 0;
  state.atApi.tickPosition = startTick;
  state.atApi.play();

  state.playingChunkId = chunkId;
  buttonEl.classList.add('playing');
  state.sectionStartTick = startTick;
  state.lastTickPos = startTick;
  state.repCount = 0;
  const sessionItem = state.sessionData?.session?.isolation?.find(i => i.chunk.id === chunkId);
  state.repTotal = state.customReps[chunkId] || sessionItem?.reps || 0;
  state.nowPlayingLabel = chunkLabel(chunk);
  state.nowPlayingBpm = sessionItem?.bpm || 0;
  updateRepDisplay();
}

export function toggleBarRangePlay(barStart, barEnd, buttonEl) {
  const rangeId = `ctx_${barStart}_${barEnd}`;
  if (!state.atApi || !state.atApi.score) return;

  if (state.playingChunkId === rangeId) {
    stopSectionPlayback();
    return;
  }

  if (state.atApi.playerState === alphaTab.synth.PlayerState.Playing) {
    state.atApi.stop();
  }
  state.playingChunkId = null;
  document.querySelectorAll('.btn-click.playing, .btn-click-small.playing').forEach(el => {
    el.classList.remove('playing');
  });

  const startBarIdx = barStart - 1;
  const endBarIdx = barEnd - 1;
  const startTick = state.atApi.score.masterBars[startBarIdx].start;
  const endMb = state.atApi.score.masterBars[endBarIdx];
  const endTick = endMb.start + endMb.calculateDuration() - 1;

  state.atApi.isLooping = true;
  state.atApi.playbackRange = { startTick, endTick };
  state.atApi.countInVolume = state.metronomeOn ? 1.0 : 0;
  state.atApi.tickPosition = startTick;
  state.atApi.play();

  state.playingChunkId = rangeId;
  buttonEl.classList.add('playing');
  state.sectionStartTick = startTick;
  state.lastTickPos = startTick;
  state.repCount = 0;
  state.repTotal = 0;
  const ctxPair = state.sessionData?.session?.context?.find(p => p.barRange[0] === barStart && p.barRange[1] === barEnd);
  state.nowPlayingLabel = `Bars ${barStart}-${barEnd}`;
  state.nowPlayingBpm = ctxPair?.bpm || 0;
  updateRepDisplay();
}

export function toggleMetronome() {
  state.metronomeOn = !state.metronomeOn;
  if (state.atApi) {
    state.atApi.metronomeVolume = state.metronomeOn ? 1.0 : 0;
    state.atApi.countInVolume = state.metronomeOn ? 1.0 : 0;
  }
  const btn = document.getElementById('metronomeBtn');
  if (btn) {
    btn.classList.toggle('active', state.metronomeOn);
  }
}

export function initPlayback() {
  const playBtn = document.getElementById('playBtn');
  const stopBtn = document.getElementById('stopBtn');
  const speedSlider = document.getElementById('speedSlider');
  const speedInput = document.getElementById('speedInput');

  playBtn.addEventListener('click', () => {
    if (!state.atApi) return;
    if (state.atApi.playerState === alphaTab.synth.PlayerState.Playing) {
      state.atApi.pause();
    } else {
      if (state.playingChunkId) {
        stopSectionPlayback();
      }
      state.atApi.playbackRange = null;
      state.atApi.isLooping = false;
      state.atApi.play();
    }
  });

  stopBtn.addEventListener('click', () => {
    let handled = false;
    emit('stop-requested', { setHandled: () => { handled = true; } });
    if (!handled) stopSectionPlayback();
  });

  document.getElementById('metronomeBtn').addEventListener('click', toggleMetronome);

  document.getElementById('helpBtn').addEventListener('click', () => {
    alert(
      'Keyboard Shortcuts\n\n' +
      'Space — Play / Pause\n' +
      'Escape — Stop\n' +
      'M — Toggle metronome\n' +
      '1 — Rate: Hard\n' +
      '2 — Rate: OK\n' +
      '3 — Rate: Clean\n\n' +
      'Rating keys apply to the currently playing or selected chunk.'
    );
  });

  function setSpeed(pct) {
    pct = Math.max(25, Math.min(300, pct));
    speedSlider.value = pct;
    speedInput.value = pct;
    if (state.atApi) state.atApi.playbackSpeed = pct / 100;
  }
  speedSlider.addEventListener('input', () => setSpeed(parseInt(speedSlider.value)));
  speedInput.addEventListener('change', () => setSpeed(parseInt(speedInput.value) || 100));
  speedInput.addEventListener('keydown', (e) => { if (e.code === 'Enter') { speedInput.blur(); } });

  document.addEventListener('keydown', (e) => {
    const isTyping = e.target.matches('input[type="text"], input[type="number"], textarea');
    const isSelect = e.target.tagName === 'SELECT';
    if (e.code === 'Space' && !isTyping && !isSelect) {
      e.preventDefault();
      playBtn.click();
    }
    if (e.code === 'Escape') {
      // Emit stop-requested so the session runner can intercept during Coach Mode.
      // If the runner is active, it calls stopSession() (which includes stopSectionPlayback).
      // If idle, the event is unhandled and we fall through to stopSectionPlayback.
      let handled = false;
      emit('stop-requested', { setHandled: () => { handled = true; } });
      if (!handled) stopSectionPlayback();
      e.target.blur();
    }
    if (e.code === 'KeyM' && !isTyping) {
      e.preventDefault();
      toggleMetronome();
    }
    if (!isTyping && (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3')) {
      const ratingMap = { Digit1: 1, Digit2: 3, Digit3: 5 };
      const rating = ratingMap[e.code];

      // First, let the session runner handle it if it's in AWAITING_RATING
      let handled = false;
      emit('runner-keyboard-rate', { rating, setHandled: () => { handled = true; } });
      if (handled) { e.preventDefault(); return; }

      // Manual mode: rate the currently playing or selected chunk
      const targetId = state.playingChunkId || state.selectedChunkId;
      if (!targetId || targetId.startsWith('ctx_')) return;
      const row = document.querySelector(`.session-item[data-chunk-id="${targetId}"]`);
      if (row) {
        e.preventDefault();
        emit('keyboard-rate', { chunkId: targetId, rating, rowEl: row });
      }
    }
  });
}
