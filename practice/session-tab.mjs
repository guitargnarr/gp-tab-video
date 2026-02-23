import state, { on, emit } from './state.mjs';
import { chunkLabel, chunkSubLabel, chunkColorByIdx } from './ui.mjs';
import { toggleSectionPlay, toggleBarRangePlay, stopSectionPlayback } from './playback.mjs';
import { highlightChunk } from './alphatab-manager.mjs';
import { renderProgressTab } from './progress-tab.mjs';

export async function rateChunk(chunkId, rating, rowEl) {
  let result;
  try {
    const resp = await fetch('/api/rate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ratings: { [chunkId]: rating } }),
    });
    result = await resp.json();
  } catch (err) {
    console.error('[Practice] Rating failed:', err);
    const np = document.getElementById('nowPlaying');
    if (np) { np.textContent = 'Rating failed -- check connection'; np.style.color = '#ff5555'; }
    setTimeout(() => { if (np) { np.textContent = ''; np.style.color = ''; } }, 3000);
    return;
  }
  if (!result.ok) return;

  state.progressData.state = result.state;

  rowEl.querySelectorAll('.rate-btn').forEach(btn => {
    const r = parseInt(btn.dataset.rating);
    if (r === rating) {
      btn.classList.add('chosen');
      btn.classList.remove('dimmed');
      btn.setAttribute('aria-pressed', 'true');
    } else {
      btn.classList.add('dimmed');
      btn.classList.remove('chosen');
      btn.setAttribute('aria-pressed', 'false');
    }
  });

  rowEl.classList.add('rated');

  const np = document.getElementById('nowPlaying');
  const prev = np ? np.textContent : '';
  if (np) { np.textContent = 'Saved'; np.style.color = '#44cc44'; }
  setTimeout(() => { if (np) { np.textContent = prev; np.style.color = ''; } }, 1500);

  renderProgressTab();
  emit('rating-saved', { chunkId, rating });
}

// Listen for keyboard ratings from playback.mjs
on('keyboard-rate', ({ chunkId, rating, rowEl }) => {
  rateChunk(chunkId, rating, rowEl);
});

export function renderSessionTab() {
  const pane = document.getElementById('pane-session');
  const session = state.sessionData.session;
  // Clear stale context ranges from previous render/generate cycles
  state.analyzeData._contextRanges = {};
  let html = '<button id="startSessionBtn">Start Session (Coach Mode)</button>';

  // Phase 1: Isolation
  html += `<div class="phase" data-phase="isolation">
    <div class="phase-header">
      <span><span class="chevron">&#9660;</span>Phase 1: Isolation</span>
      <span class="phase-time">~${session.phaseTime.isolation} min</span>
    </div>
    <div class="phase-body">
    <div class="phase-desc">Slow tempos, clean execution. Ordered by priority (weakest first). 30s rest between chunks.</div>`;

  for (const item of session.isolation) {
    const chunk = item.chunk;
    const color = chunkColorByIdx(chunk.id);
    const review = item.isReview ? '<span class="review-tag">REVIEW</span>' : '';

    html += `
      <div class="session-item" data-chunk-id="${chunk.id}">
        <div class="chunk-color" style="background:${color}"></div>
        <div class="chunk-body">
          <div class="chunk-label">${chunkLabel(chunk)}${review}</div>
          <div class="chunk-sublabel">${chunkSubLabel(chunk)}</div>
          <div class="chunk-meta">${item.level} &middot; ${item.bpm} BPM (${Math.round(item.tempoPct * 100)}%) &middot; <button class="rep-adj" data-chunk-id="${chunk.id}" data-delta="-1" title="Fewer reps">-</button> <span class="rep-count" data-chunk-id="${chunk.id}">${item.reps}</span> reps <button class="rep-adj" data-chunk-id="${chunk.id}" data-delta="1" title="More reps">+</button></div>
        </div>
        <div class="chunk-controls">
          <button class="btn-click" data-chunk-id="${chunk.id}" title="Toggle click track">&#9654;</button>
          <div class="rate-row" data-chunk-id="${chunk.id}">
            <button class="rate-btn r1" data-rating="1" title="Struggled" aria-pressed="false">Hard</button>
            <button class="rate-btn r3" data-rating="3" title="Okay" aria-pressed="false">OK</button>
            <button class="rate-btn r5" data-rating="5" title="Clean" aria-pressed="false">Clean</button>
          </div>
        </div>
      </div>`;
  }
  html += `</div></div>`;

  // Phase 2: Context
  if (session.context.length > 0) {
    html += `<div class="phase" data-phase="context">
      <div class="phase-header">
        <span><span class="chevron">&#9660;</span>Phase 2: Context</span>
        <span class="phase-time">~${session.phaseTime.context} min</span>
      </div>
      <div class="phase-body">
      <div class="phase-desc">Connect adjacent chunks. Focus on transitions.</div>`;

    for (const pair of session.context) {
      const ids = pair.chunks.map(c => chunkLabel(c)).join(' + ');
      const ctxId = `ctx_${pair.barRange[0]}_${pair.barRange[1]}`;
      if (!state.analyzeData._contextRanges) state.analyzeData._contextRanges = {};
      state.analyzeData._contextRanges[ctxId] = { barRange: pair.barRange };
      html += `
        <div class="session-item session-context" data-context-id="${ctxId}">
          <div class="chunk-color" style="background:#666"></div>
          <div class="chunk-body">
            <div class="chunk-label">${ids}</div>
            <div class="chunk-sublabel">Bars ${pair.barRange[0]}-${pair.barRange[1]}</div>
            <div class="chunk-meta">${pair.bpm} BPM (${Math.round(pair.tempoPct * 100)}%)</div>
          </div>
          <div class="chunk-controls">
            <button class="btn-click" data-context-id="${ctxId}" data-bar-start="${pair.barRange[0]}" data-bar-end="${pair.barRange[1]}" title="Play this section">&#9654;</button>
          </div>
        </div>`;
    }
    html += `</div></div>`;
  }

  // Phase 3: Interleaving
  if (session.interleaving.chunks.length > 0) {
    const labels = session.interleaving.chunks.map(c => chunkLabel(c)).join(', ');
    html += `<div class="phase" data-phase="interleaving">
      <div class="phase-header">
        <span><span class="chevron">&#9660;</span>Phase 3: Interleaving</span>
        <span class="phase-time">~${session.phaseTime.interleaving} min</span>
      </div>
      <div class="phase-body">
      <div class="phase-desc">Random order. Forces recall.</div>
      <div class="session-item">
        <div class="chunk-color" style="background:#cc66ff"></div>
        <div class="chunk-body">
          <div class="chunk-label">Shuffle</div>
          <div class="chunk-sublabel">${labels}</div>
          <div class="chunk-meta">${session.interleaving.bpm} BPM (${Math.round(session.interleaving.tempoPct * 100)}%) &middot; 2 reps each</div>
        </div>
        <div class="chunk-controls">
          <button class="btn-click" data-context-id="shuffle" data-bar-start="1" data-bar-end="${state.fileInfo.bars}" title="Play all chunks">&#9654;</button>
        </div>
      </div>
    </div></div>`;
  }

  // Phase 4: Run-through
  html += `<div class="phase" data-phase="runthrough">
    <div class="phase-header">
      <span><span class="chevron">&#9660;</span>Phase 4: Run-through</span>
      <span class="phase-time">~${session.phaseTime.runthrough} min</span>
    </div>
    <div class="phase-body">
    <div class="phase-desc">Full piece. Note problem spots.</div>
    <div class="session-item" data-runthrough="1">
      <div class="chunk-color" style="background:#55ff88"></div>
      <div class="chunk-body">
        <div class="chunk-label">Full piece</div>
        <div class="chunk-sublabel">All ${state.fileInfo.bars} bars</div>
        <div class="chunk-meta">${session.runthrough.bpm} BPM (${Math.round(session.runthrough.tempoPct * 100)}%)</div>
      </div>
      <div class="chunk-controls">
        <button class="btn-click" data-context-id="runthrough" data-bar-start="1" data-bar-end="${state.fileInfo.bars}" title="Play full piece">&#9654;</button>
        <div class="rate-row" data-runthrough="1">
          <button class="rate-btn r1" data-rating="1" title="Struggled">Hard</button>
          <button class="rate-btn r3" data-rating="3" title="Okay">OK</button>
          <button class="rate-btn r5" data-rating="5" title="Clean">Clean</button>
        </div>
      </div>
    </div>
  </div></div>`;

  pane.innerHTML = html;
  attachSessionListeners(pane);
}

function attachSessionListeners(pane) {
  pane.querySelectorAll('.phase-header').forEach(header => {
    header.addEventListener('click', () => {
      header.closest('.phase').classList.toggle('collapsed');
    });
  });

  pane.querySelectorAll('.session-item[data-chunk-id]').forEach(el => {
    el.querySelector('.chunk-body')?.addEventListener('click', (e) => {
      if (e.target.closest('.rep-adj')) return;
      highlightChunk(el.dataset.chunkId);
    });
  });

  pane.querySelectorAll('.rep-adj').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const cid = btn.dataset.chunkId;
      const delta = parseInt(btn.dataset.delta);
      const span = pane.querySelector(`.rep-count[data-chunk-id="${cid}"]`);
      if (!span) return;
      const current = parseInt(span.textContent) || 1;
      const newVal = Math.max(1, Math.min(20, current + delta));
      span.textContent = newVal;
      state.customReps[cid] = newVal;
      if (state.playingChunkId === cid) state.repTotal = newVal;
    });
  });

  pane.querySelectorAll('.btn-click').forEach(btn => {
    if (btn.dataset.contextId) {
      btn.addEventListener('click', () => toggleBarRangePlay(
        parseInt(btn.dataset.barStart), parseInt(btn.dataset.barEnd), btn
      ));
    } else {
      btn.addEventListener('click', () => toggleSectionPlay(btn.dataset.chunkId, btn));
    }
  });

  pane.querySelectorAll('.rate-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const row = btn.closest('.session-item');
      const rateRow = btn.closest('.rate-row');
      if (rateRow.dataset.runthrough) {
        const rating = parseInt(btn.dataset.rating);
        rateRow.querySelectorAll('.rate-btn').forEach(b => {
          if (parseInt(b.dataset.rating) === rating) {
            b.classList.add('chosen'); b.classList.remove('dimmed');
            b.setAttribute('aria-pressed', 'true');
          } else {
            b.classList.add('dimmed'); b.classList.remove('chosen');
            b.setAttribute('aria-pressed', 'false');
          }
        });
        row.classList.add('rated');
      } else {
        rateChunk(rateRow.dataset.chunkId, parseInt(btn.dataset.rating), row);
      }
    });
  });
}
