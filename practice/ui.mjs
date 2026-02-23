import state from './state.mjs';
import { CHUNK_COLORS } from './constants.mjs';

export function switchToTab(tabName) {
  document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  const tab = document.querySelector(`.panel-tab[data-tab="${tabName}"]`);
  if (tab) tab.classList.add('active');
  const pane = document.getElementById('pane-' + tabName);
  if (pane) pane.classList.add('active');
}

export function initTabs() {
  document.querySelectorAll('.panel-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('pane-' + tab.dataset.tab).classList.add('active');
    });
  });
}

export function chunkLabel(chunk) {
  if (chunk.label && !chunk.label.startsWith('Bar')) return chunk.label;
  return chunk.barRange[0] === chunk.barRange[1]
    ? `Bar ${chunk.barRange[0]}`
    : `Bars ${chunk.barRange[0]}-${chunk.barRange[1]}`;
}

export function chunkSubLabel(chunk) {
  const barStr = chunk.barRange[0] === chunk.barRange[1]
    ? `Bar ${chunk.barRange[0]}`
    : `Bars ${chunk.barRange[0]}-${chunk.barRange[1]}`;
  const techStr = chunk.techniques?.length > 0 ? chunk.techniques.join(', ') : '';
  if (techStr) return `${barStr} -- ${techStr}`;
  if (chunk.difficulty != null) return `Difficulty: ${chunk.difficulty}/100`;
  return barStr;
}

export function diffColor(diff) {
  if (diff >= 80) return '#ff4444';
  if (diff >= 60) return '#ff8800';
  if (diff >= 40) return '#ffcc00';
  return '#44cc44';
}

export function chunkColorByIdx(chunkId) {
  const idx = state.analyzeData.chunks.findIndex(c => c.id === chunkId);
  return CHUNK_COLORS[idx >= 0 ? idx % CHUNK_COLORS.length : 0];
}

export function updateFileInfoBar() {
  const fi = state.fileInfo;
  document.getElementById('fileInfo').innerHTML = `
    <strong>${fi.title}</strong> &middot;
    ${fi.tempo} BPM &middot;
    ${fi.bars} bars &middot;
    ${fi.tracks[fi.activeTrack]?.name || 'Track ' + fi.activeTrack}
    ${fi.tuning ? ' &middot; ' + fi.tuning.name : ''}
  `;
}
