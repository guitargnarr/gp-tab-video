import state from './state.mjs';
import { CHUNK_COLORS } from './constants.mjs';
import { chunkLabel, chunkSubLabel, diffColor } from './ui.mjs';
import { toggleSectionPlay } from './playback.mjs';
import { highlightChunk } from './alphatab-manager.mjs';

export function renderChunksTab() {
  const pane = document.getElementById('pane-chunks');
  let html = '';

  for (let i = 0; i < state.analyzeData.chunks.length; i++) {
    const chunk = state.analyzeData.chunks[i];
    const color = CHUNK_COLORS[i % CHUNK_COLORS.length];
    const diff = chunk.difficulty;

    const cs = state.progressData.state.chunks[chunk.id];
    const lvl = cs ? cs.masteryLevel : 0;
    const levelName = state.progressData.masteryLevels[lvl]?.name || 'New';

    html += `
      <div class="chunk-row" data-chunk-id="${chunk.id}">
        <div class="chunk-color" style="background:${color}"></div>
        <div class="chunk-info">
          <div class="chunk-label">${chunkLabel(chunk)} <span style="color:#555;font-weight:400;font-size:10px">${levelName}</span></div>
          <div class="chunk-sublabel">${chunkSubLabel(chunk)}</div>
        </div>
        <div class="diff-bar-outer">
          <div class="diff-bar-container">
            <div class="diff-bar-fill" style="width:${diff}%;background:${diffColor(diff)}"></div>
          </div>
          <div class="diff-label" title="Difficulty score (0-100)">${diff}</div>
        </div>
        <button class="btn-click-small" data-chunk-id="${chunk.id}" title="Toggle click track">&#9654;</button>
      </div>`;
  }

  pane.innerHTML = html;

  pane.querySelectorAll('.chunk-row').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.btn-click-small')) return;
      highlightChunk(el.dataset.chunkId);
    });
  });

  pane.querySelectorAll('.btn-click-small').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSectionPlay(btn.dataset.chunkId, btn);
    });
  });
}
