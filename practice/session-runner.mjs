import state, { on, off, emit } from './state.mjs';
import { chunkLabel } from './ui.mjs';
import { toggleSectionPlay, toggleBarRangePlay, stopSectionPlayback, updateRepDisplay } from './playback.mjs';
import { rateChunk } from './session-tab.mjs';

// State machine: IDLE -> PLAYING -> AWAITING_RATING -> REST -> PLAYING (next)
//                                                           -> PHASE_INTERSTITIAL -> PLAYING
//                                                           -> SESSION_COMPLETE
// Any state -> IDLE (Stop Session)

const runner = {
  status: 'IDLE',         // IDLE | PLAYING | AWAITING_RATING | REST | PHASE_INTERSTITIAL | SESSION_COMPLETE
  items: [],              // flat list of all playable items
  currentIdx: -1,         // index into items[]
  currentPhase: '',       // name of current phase
  startTime: null,        // session start timestamp
  phaseStartTime: null,   // current phase start timestamp
  restDuration: 5000,     // ms between items
  restTimer: null,        // requestAnimationFrame id
  restStart: null,        // timestamp when rest started
  tempoRamp: false,       // whether tempo ramping is enabled
  tempoRampPct: 0.05,     // 5% per rep
  results: [],            // { chunkId, label, rating, bpmStart, bpmEnd, phase }
  phaseResults: [],       // per-phase tracking
};

export function getRunnerState() { return runner; }

export function isRunnerActive() { return runner.status !== 'IDLE'; }

// Build flat item list from session data
function buildItemList() {
  const session = state.sessionData.session;
  const items = [];

  // Phase 1: Isolation
  for (const item of session.isolation) {
    items.push({
      phase: 'Isolation',
      phaseIdx: 0,
      type: 'chunk',
      chunkId: item.chunk.id,
      chunk: item.chunk,
      label: chunkLabel(item.chunk),
      bpm: item.bpm,
      tempoPct: item.tempoPct,
      reps: state.customReps[item.chunk.id] || item.reps,
      level: item.level,
      needsRating: true,
    });
  }

  // Phase 2: Context
  for (const pair of session.context) {
    items.push({
      phase: 'Context',
      phaseIdx: 1,
      type: 'range',
      barStart: pair.barRange[0],
      barEnd: pair.barRange[1],
      label: pair.chunks.map(c => chunkLabel(c)).join(' + '),
      bpm: pair.bpm,
      tempoPct: pair.tempoPct,
      reps: 0,
      needsRating: false,
    });
  }

  // Phase 3: Interleaving -- shuffle the chunks
  if (session.interleaving.chunks.length > 0) {
    const shuffled = [...session.interleaving.chunks];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    for (const chunk of shuffled) {
      items.push({
        phase: 'Interleaving',
        phaseIdx: 2,
        type: 'chunk',
        chunkId: chunk.id,
        chunk,
        label: chunkLabel(chunk),
        bpm: session.interleaving.bpm,
        tempoPct: session.interleaving.tempoPct,
        reps: 2,
        needsRating: false,
      });
    }
  }

  // Phase 4: Run-through
  items.push({
    phase: 'Run-through',
    phaseIdx: 3,
    type: 'range',
    barStart: 1,
    barEnd: state.fileInfo.bars,
    label: 'Full piece',
    bpm: session.runthrough.bpm,
    tempoPct: session.runthrough.tempoPct,
    reps: 0,
    needsRating: true,
    isRunthrough: true,
  });

  return items;
}

// --- UI ---

function getRunnerBar() {
  return document.getElementById('runner-bar');
}

function renderRunnerBar() {
  const bar = getRunnerBar();
  if (!bar) return;

  if (runner.status === 'IDLE') {
    bar.style.display = 'none';
    return;
  }

  bar.style.display = 'flex';
  const item = runner.items[runner.currentIdx];
  const phaseItemsTotal = runner.items.filter(i => i.phase === item?.phase).length;
  const phaseItemsDone = runner.items.filter((i, idx) => i.phase === item?.phase && idx < runner.currentIdx).length;

  const elapsed = runner.startTime ? Math.floor((Date.now() - runner.startTime) / 1000) : 0;
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;

  let statusText = '';
  if (runner.status === 'PLAYING') statusText = `Playing: ${item?.label || ''}`;
  else if (runner.status === 'AWAITING_RATING') statusText = 'Rate this chunk';
  else if (runner.status === 'REST') statusText = 'Rest';
  else if (runner.status === 'PHASE_INTERSTITIAL') statusText = `${item?.phase || 'Next'} phase`;
  else if (runner.status === 'SESSION_COMPLETE') statusText = 'Session complete';

  bar.innerHTML = `
    <span class="runner-status">${statusText}</span>
    <span class="runner-phase">${item?.phase || ''} ${phaseItemsDone + 1}/${phaseItemsTotal}</span>
    <span class="runner-time">${mins}:${secs.toString().padStart(2, '0')}</span>
    <label class="runner-ramp">
      <input type="checkbox" id="tempoRampToggle" ${runner.tempoRamp ? 'checked' : ''}>
      Ramp
    </label>
    <button id="stopSessionBtn" class="runner-stop">Stop Session</button>
  `;

  document.getElementById('stopSessionBtn').addEventListener('click', stopSession);
  document.getElementById('tempoRampToggle').addEventListener('change', (e) => {
    runner.tempoRamp = e.target.checked;
  });
}

function highlightCurrentItem() {
  // Remove all runner highlights
  document.querySelectorAll('.session-item').forEach(el => {
    el.classList.remove('runner-active', 'runner-done', 'runner-dimmed');
  });

  if (runner.status === 'IDLE') return;

  const doneIndices = new Set();
  for (let i = 0; i < runner.currentIdx; i++) doneIndices.add(i);

  runner.items.forEach((item, idx) => {
    let el;
    if (item.type === 'chunk') {
      el = document.querySelector(`.session-item[data-chunk-id="${item.chunkId}"]`);
    }
    if (!el) return;

    if (idx === runner.currentIdx) {
      el.classList.add('runner-active');
    } else if (doneIndices.has(idx)) {
      el.classList.add('runner-done');
    } else {
      el.classList.add('runner-dimmed');
    }
  });
}

function showPhaseInterstitial(prevPhase, nextPhase) {
  runner.status = 'PHASE_INTERSTITIAL';
  renderRunnerBar();

  const pane = document.getElementById('pane-session');
  const overlay = document.createElement('div');
  overlay.className = 'runner-interstitial';

  const descriptions = {
    'Context': 'Connect adjacent chunks. Focus on smooth transitions.',
    'Interleaving': 'Random order practice. Forces recall and builds flexibility.',
    'Run-through': 'Full piece from start to finish. Note any problem spots.',
  };

  overlay.innerHTML = `
    <div class="interstitial-card">
      <div class="interstitial-check">${prevPhase} complete</div>
      <div class="interstitial-next">Up next: ${nextPhase}</div>
      <div class="interstitial-desc">${descriptions[nextPhase] || ''}</div>
      <button class="interstitial-btn" id="interstitialContinue">Continue</button>
    </div>
  `;

  pane.prepend(overlay);

  // Auto-advance after 5s
  let autoTimer = setTimeout(() => {
    overlay.remove();
    playCurrentItem();
  }, 5000);

  document.getElementById('interstitialContinue').addEventListener('click', () => {
    clearTimeout(autoTimer);
    overlay.remove();
    playCurrentItem();
  });
}

function showSessionSummary() {
  runner.status = 'SESSION_COMPLETE';
  renderRunnerBar();

  const endTime = Date.now();
  const totalMinutes = Math.round((endTime - runner.startTime) / 60000);

  // Compute stats
  const ratedItems = runner.results.filter(r => r.rating != null);
  const avgRating = ratedItems.length > 0
    ? (ratedItems.reduce((sum, r) => sum + r.rating, 0) / ratedItems.length).toFixed(1)
    : 'N/A';

  const improved = ratedItems.filter(r => r.rating >= 5).map(r => r.label);
  const needsWork = ratedItems.filter(r => r.rating <= 1).map(r => r.label);

  const pane = document.getElementById('pane-session');
  const overlay = document.createElement('div');
  overlay.className = 'runner-summary';

  overlay.innerHTML = `
    <div class="summary-card">
      <h3 class="summary-title">Session Complete</h3>
      <div class="summary-stats">
        <div class="summary-stat"><span class="summary-val">${totalMinutes}</span><span class="summary-lbl">minutes</span></div>
        <div class="summary-stat"><span class="summary-val">${runner.results.length}</span><span class="summary-lbl">items</span></div>
        <div class="summary-stat"><span class="summary-val">${avgRating}</span><span class="summary-lbl">avg rating</span></div>
      </div>
      ${improved.length > 0 ? `<div class="summary-section"><div class="summary-heading">Nailed it</div><div class="summary-list">${improved.join(', ')}</div></div>` : ''}
      ${needsWork.length > 0 ? `<div class="summary-section"><div class="summary-heading">Needs work</div><div class="summary-list">${needsWork.join(', ')}</div></div>` : ''}
      <button class="summary-btn" id="newSessionBtn">Done</button>
    </div>
  `;

  pane.prepend(overlay);

  document.getElementById('newSessionBtn').addEventListener('click', () => {
    overlay.remove();
    resetRunner();
  });
}

// --- Core logic ---

function playCurrentItem() {
  const item = runner.items[runner.currentIdx];
  if (!item) {
    showSessionSummary();
    return;
  }

  runner.status = 'PLAYING';
  runner.currentPhase = item.phase;
  renderRunnerBar();
  highlightCurrentItem();

  // Set playback speed for this item
  if (state.atApi) {
    let speed = item.tempoPct;
    // If tempo ramping, start at the item's tempo (will ramp up per rep)
    state.atApi.playbackSpeed = speed;
  }

  if (item.type === 'chunk') {
    const btn = document.querySelector(`.session-item[data-chunk-id="${item.chunkId}"] .btn-click`);
    if (btn) toggleSectionPlay(item.chunkId, btn);
  } else if (item.type === 'range') {
    const ctxId = `ctx_${item.barStart}_${item.barEnd}`;
    const btn = document.querySelector(`.btn-click[data-context-id="${ctxId}"]`) ||
                document.querySelector(`.btn-click[data-bar-start="${item.barStart}"][data-bar-end="${item.barEnd}"]`);
    if (btn) toggleBarRangePlay(item.barStart, item.barEnd, btn);
  }
}

function onRepCompleted({ repCount, repTotal }) {
  if (runner.status !== 'PLAYING') return;
  const item = runner.items[runner.currentIdx];
  if (!item) return;

  // Tempo ramping
  if (runner.tempoRamp && state.atApi) {
    const currentSpeed = state.atApi.playbackSpeed;
    const maxSpeed = 1.0; // Never exceed 100% of base tempo
    const newSpeed = Math.min(maxSpeed, currentSpeed + runner.tempoRampPct);
    state.atApi.playbackSpeed = newSpeed;
    // Update now-playing BPM display
    state.nowPlayingBpm = Math.round(state.fileInfo.tempo * newSpeed);
    updateRepDisplay();
  }

  // Check if all reps done
  if (item.reps > 0 && repCount >= item.reps) {
    stopSectionPlayback();
    if (item.needsRating) {
      transitionToRating();
    } else {
      advanceToNext();
    }
  }
}

function onStopRequested({ setHandled }) {
  // Intercept Escape/Stop during Coach Mode -- stop the entire session
  if (runner.status !== 'IDLE') {
    setHandled();
    stopSession();
  }
}

function onPlaybackStopped() {
  if (runner.status !== 'PLAYING') return;
  const item = runner.items[runner.currentIdx];
  if (!item) return;

  // For items with no rep limit (run-through, context), transition on stop
  if (item.reps === 0) {
    if (item.needsRating) {
      transitionToRating();
    } else {
      advanceToNext();
    }
  }
}

function transitionToRating() {
  runner.status = 'AWAITING_RATING';
  renderRunnerBar();
  highlightCurrentItem();

  // Highlight rating buttons for this item
  const item = runner.items[runner.currentIdx];
  const row = findItemRow(item);
  if (row) {
    row.querySelectorAll('.rate-btn').forEach(btn => {
      btn.style.animation = 'pulse-glow 1s infinite';
    });
    // Scroll the row into view so the user can see the pulsing buttons
    row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function findItemRow(item) {
  if (!item) return null;
  if (item.type === 'chunk') {
    return document.querySelector(`.session-item[data-chunk-id="${item.chunkId}"]`);
  }
  if (item.isRunthrough) {
    return document.querySelector('.session-item[data-runthrough="1"]');
  }
  // Context range
  const ctxId = `ctx_${item.barStart}_${item.barEnd}`;
  return document.querySelector(`.session-item[data-context-id="${ctxId}"]`);
}

function onRatingSaved({ chunkId, rating }) {
  if (runner.status !== 'AWAITING_RATING') return;
  const item = runner.items[runner.currentIdx];
  if (!item) return;

  // Record result
  runner.results.push({
    chunkId: item.chunkId || null,
    label: item.label,
    rating,
    bpmStart: item.bpm,
    bpmEnd: state.atApi ? Math.round(state.fileInfo.tempo * state.atApi.playbackSpeed) : item.bpm,
    phase: item.phase,
  });

  // Clear pulse animation
  const row = findItemRow(item);
  if (row) {
    row.querySelectorAll('.rate-btn').forEach(btn => {
      btn.style.animation = '';
    });
  }

  advanceToNext();
}

function advanceToNext() {
  const currentItem = runner.items[runner.currentIdx];
  runner.currentIdx++;

  if (runner.currentIdx >= runner.items.length) {
    showSessionSummary();
    return;
  }

  const nextItem = runner.items[runner.currentIdx];

  // Check for phase change
  if (currentItem && nextItem && currentItem.phase !== nextItem.phase) {
    showPhaseInterstitial(currentItem.phase, nextItem.phase);
    return;
  }

  // Rest timer between items
  startRest();
}

function startRest() {
  runner.status = 'REST';
  runner.restStart = Date.now();
  renderRunnerBar();
  highlightCurrentItem();

  // Show rest countdown in runner bar
  const nextItem = runner.items[runner.currentIdx];
  const restOverlay = document.createElement('div');
  restOverlay.className = 'runner-rest-bar';
  restOverlay.id = 'runnerRestOverlay';

  const nextLabel = nextItem ? `Next: ${nextItem.label}${nextItem.bpm ? ` at ${nextItem.bpm} BPM` : ''}` : '';
  restOverlay.innerHTML = `
    <div class="rest-label">${nextLabel}</div>
    <div class="rest-progress"><div class="rest-fill" id="restFill"></div></div>
    <button class="rest-skip" id="skipRestBtn">Skip</button>
  `;

  const bar = getRunnerBar();
  if (bar) bar.after(restOverlay);

  document.getElementById('skipRestBtn')?.addEventListener('click', () => {
    cancelRest();
    playCurrentItem();
  });

  // Animate countdown
  function tick() {
    if (runner.status !== 'REST') return;
    const elapsed = Date.now() - runner.restStart;
    const pct = Math.min(100, (elapsed / runner.restDuration) * 100);
    const fill = document.getElementById('restFill');
    if (fill) fill.style.width = pct + '%';

    if (elapsed >= runner.restDuration) {
      cancelRest();
      playCurrentItem();
    } else {
      runner.restTimer = requestAnimationFrame(tick);
    }
  }
  runner.restTimer = requestAnimationFrame(tick);
}

function cancelRest() {
  if (runner.restTimer) {
    cancelAnimationFrame(runner.restTimer);
    runner.restTimer = null;
  }
  document.getElementById('runnerRestOverlay')?.remove();
}

// --- Public API ---

export function startSession() {
  if (runner.status !== 'IDLE') return;
  if (!state.sessionData || !state.fileLoaded) return;

  runner.items = buildItemList();
  if (runner.items.length === 0) return;

  runner.currentIdx = 0;
  runner.startTime = Date.now();
  runner.phaseStartTime = Date.now();
  runner.results = [];

  // Subscribe to events
  on('rep-completed', onRepCompleted);
  on('playback-stopped', onPlaybackStopped);
  on('rating-saved', onRatingSaved);
  on('stop-requested', onStopRequested);

  // Start elapsed timer update
  runner._timerInterval = setInterval(() => {
    if (runner.status !== 'IDLE' && runner.status !== 'SESSION_COMPLETE') {
      renderRunnerBar();
    }
  }, 1000);

  playCurrentItem();
}

export function stopSession() {
  cancelRest();
  stopSectionPlayback();
  resetRunner();
}

function resetRunner() {
  runner.status = 'IDLE';
  runner.items = [];
  runner.currentIdx = -1;
  runner.results = [];

  off('rep-completed', onRepCompleted);
  off('playback-stopped', onPlaybackStopped);
  off('rating-saved', onRatingSaved);
  off('stop-requested', onStopRequested);

  if (runner._timerInterval) {
    clearInterval(runner._timerInterval);
    runner._timerInterval = null;
  }

  renderRunnerBar();
  highlightCurrentItem();

  // Remove any lingering overlays
  document.querySelectorAll('.runner-interstitial, .runner-summary, .runner-rest-bar').forEach(el => el.remove());
}

// Handle keyboard rating during Coach Mode AWAITING_RATING.
// This intercepts before the normal keyboard-rate path so it works for
// both chunk items (which also go through rateChunk) and range items
// like run-through (which have no server-side chunk to rate).
on('runner-keyboard-rate', ({ rating, setHandled }) => {
  if (runner.status !== 'AWAITING_RATING') return;
  const item = runner.items[runner.currentIdx];
  if (!item) return;

  setHandled();

  if (item.type === 'chunk') {
    // For chunks, trigger the normal rateChunk flow which emits rating-saved
    const row = findItemRow(item);
    if (row) rateChunk(item.chunkId, rating, row);
    // onRatingSaved will handle advancing
  } else {
    // For range items (run-through), apply visual-only rating and advance directly
    const row = findItemRow(item);
    if (row) {
      row.querySelectorAll('.rate-btn').forEach(btn => {
        const r = parseInt(btn.dataset.rating);
        if (r === rating) {
          btn.classList.add('chosen'); btn.classList.remove('dimmed');
        } else {
          btn.classList.add('dimmed'); btn.classList.remove('chosen');
        }
      });
      row.classList.add('rated');
    }
    // Record result and advance (no server call for run-through)
    runner.results.push({
      chunkId: null,
      label: item.label,
      rating,
      bpmStart: item.bpm,
      bpmEnd: state.atApi ? Math.round(state.fileInfo.tempo * state.atApi.playbackSpeed) : item.bpm,
      phase: item.phase,
    });
    // Clear pulse
    if (row) {
      row.querySelectorAll('.rate-btn').forEach(btn => { btn.style.animation = ''; });
    }
    advanceToNext();
  }
});
