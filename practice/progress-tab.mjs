import state from './state.mjs';
import { chunkLabel } from './ui.mjs';

export function renderProgressTab() {
  const pane = document.getElementById('pane-progress');
  const ps = state.progressData.state;
  const chunks = state.analyzeData.chunks;
  const levels = state.progressData.masteryLevels;

  const total = chunks.length;
  const mastered = chunks.filter(c => (ps.chunks[c.id]?.masteryLevel || 0) >= 5).length;
  const learning = chunks.filter(c => {
    const l = ps.chunks[c.id]?.masteryLevel || 0;
    return l > 0 && l < 5;
  }).length;
  const newCount = chunks.filter(c => (ps.chunks[c.id]?.masteryLevel || 0) === 0).length;
  const overallPct = total > 0 ? Math.round((mastered / total) * 100) : 0;

  let html = `
    <div class="progress-summary">
      <div class="stat-card"><div class="stat-value">${ps.sessionCount}</div><div class="stat-label">Sessions</div></div>
      <div class="stat-card"><div class="stat-value">${overallPct}%</div><div class="stat-label">Mastered</div></div>
      <div class="stat-card"><div class="stat-value">${learning}</div><div class="stat-label">Learning</div></div>
      <div class="stat-card"><div class="stat-value">${newCount}</div><div class="stat-label">New</div></div>
    </div>
    <div class="overall-bar">
      <div class="bar-label">Overall: ${mastered} / ${total} chunks mastered</div>
      <div class="bar-track"><div class="bar-fill" style="width:${overallPct}%"></div></div>
    </div>`;

  const now = new Date();
  for (const chunk of chunks) {
    const cs = ps.chunks[chunk.id];
    const lvl = cs ? cs.masteryLevel : 0;
    const level = levels[lvl] || levels[0];
    const pct = Math.round((lvl / 5) * 100);
    const barStr = chunk.barRange[0] === chunk.barRange[1]
      ? `Bar ${chunk.barRange[0]}`
      : `${chunk.barRange[0]}-${chunk.barRange[1]}`;

    let reviewStr = '';
    if (cs?.nextReview) {
      const rd = new Date(cs.nextReview);
      if (rd <= now) reviewStr = ' (due)';
      else {
        const d = Math.ceil((rd - now) / 86400000);
        reviewStr = ` (${d}d)`;
      }
    }

    html += `
      <div class="progress-chunk">
        <div class="p-id">${chunkLabel(chunk)}</div>
        <div class="p-bars">${barStr}</div>
        <div class="p-bar-container"><div class="p-bar-fill" style="width:${pct}%"></div></div>
        <div class="p-level">${level.name}${reviewStr}</div>
      </div>`;
  }

  pane.innerHTML = html;
}
