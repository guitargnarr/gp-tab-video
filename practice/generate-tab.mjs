import state from './state.mjs';
import { PATTERN_CONTROLS, FORM_IDS } from './constants.mjs';
import { switchToTab, updateFileInfoBar } from './ui.mjs';
import { stopSectionPlayback } from './playback.mjs';
import { loadAlphaTabFile } from './alphatab-manager.mjs';
import { renderSessionTab } from './session-tab.mjs';
import { renderChunksTab } from './chunks-tab.mjs';
import { renderProgressTab } from './progress-tab.mjs';

let fretboardCache = {};
let fretboardAbort = null;

async function fetchBoxPosition(root, scale, position, tuning) {
  const key = `${root}-${scale}-${position}-${tuning}`;
  if (fretboardCache[key]) return fretboardCache[key];
  if (fretboardAbort) fretboardAbort.abort();
  fretboardAbort = new AbortController();
  const params = new URLSearchParams({ root, scale, position, tuning });
  const resp = await fetch(`/api/box-position?${params}`, { signal: fretboardAbort.signal });
  if (!resp.ok) throw new Error(`API error ${resp.status}`);
  const data = await resp.json();
  if (data.error) throw new Error(data.error);
  fretboardCache[key] = data;
  return data;
}

function buildFretboardSVG(data) {
  const notes = data.notes;
  if (!notes || notes.length === 0) return '<div class="fb-error">No notes in this position</div>';

  const frets = notes.map(n => n.fret);
  let minFret = Math.min(...frets);
  let maxFret = Math.max(...frets);
  if (maxFret - minFret < 3) maxFret = minFret + 3;

  const hasOpen = minFret === 0;
  const displayMin = minFret;
  const displayMax = maxFret + 1;
  const fretCount = displayMax - displayMin + 1;

  const leftPad = 30;
  const topPad = 18;
  const fretSpacing = 48;
  const stringSpacing = 20;
  const dotR = 8;
  const width = leftPad + fretCount * fretSpacing + 10;
  const height = topPad + 5 * stringSpacing + 16;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">`;

  const tn = data.tuning_notes || ['E','A','D','G','B','E'];
  for (let s = 0; s < 6; s++) {
    const y = topPad + (5 - s) * stringSpacing;
    svg += `<text x="${leftPad - 6}" y="${y + 4}" text-anchor="end" font-size="9" fill="#888" font-family="monospace">${tn[s]}</text>`;
  }

  for (let f = displayMin; f <= displayMax; f++) {
    const x = leftPad + (f - displayMin) * fretSpacing;
    if (f > 0 || hasOpen) {
      svg += `<text x="${x + fretSpacing / 2}" y="${topPad - 5}" text-anchor="middle" font-size="8" fill="#555" font-family="monospace">${f}</text>`;
    }
  }

  if (hasOpen) {
    const x = leftPad + fretSpacing;
    svg += `<line x1="${x}" y1="${topPad - 1}" x2="${x}" y2="${topPad + 5 * stringSpacing + 1}" stroke="#aaa" stroke-width="3"/>`;
  }

  for (let f = displayMin; f <= displayMax; f++) {
    if (hasOpen && f === 0) continue;
    const xPos = leftPad + (f - displayMin + 1) * fretSpacing;
    svg += `<line x1="${xPos}" y1="${topPad}" x2="${xPos}" y2="${topPad + 5 * stringSpacing}" stroke="#444" stroke-width="1"/>`;
  }

  const strX1 = leftPad + fretSpacing;
  const strX2 = leftPad + fretCount * fretSpacing;
  for (let s = 0; s < 6; s++) {
    const y = topPad + s * stringSpacing;
    const sw = s <= 1 ? 2 : (s <= 3 ? 1.5 : 1);
    svg += `<line x1="${strX1}" y1="${y}" x2="${strX2}" y2="${y}" stroke="#555" stroke-width="${sw}"/>`;
  }

  const singles = [3, 5, 7, 9, 15, 17, 19, 21];
  const doubles = [12, 24];
  for (let f = displayMin; f <= displayMax; f++) {
    const cx = leftPad + (f - displayMin + 0.5) * fretSpacing;
    if (singles.includes(f)) {
      svg += `<circle cx="${cx}" cy="${topPad + 2.5 * stringSpacing}" r="2.5" fill="#2a2a2a"/>`;
    }
    if (doubles.includes(f)) {
      svg += `<circle cx="${cx}" cy="${topPad + 1.5 * stringSpacing}" r="2.5" fill="#2a2a2a"/>`;
      svg += `<circle cx="${cx}" cy="${topPad + 3.5 * stringSpacing}" r="2.5" fill="#2a2a2a"/>`;
    }
  }

  for (const note of notes) {
    let x;
    if (note.fret === 0) {
      x = leftPad + fretSpacing * 0.5;
    } else {
      x = leftPad + (note.fret - displayMin + 0.5) * fretSpacing;
    }
    const y = topPad + (5 - note.string) * stringSpacing;
    const tip = `${note.note} (string ${note.string + 1}, fret ${note.fret}, finger ${note.finger})${note.is_root ? ' — ROOT' : ''}`;

    svg += `<g style="cursor:pointer" class="fb-note" data-note="${note.note}" data-fret="${note.fret}" data-string="${note.string}">`;
    if (note.is_root) {
      svg += `<circle cx="${x}" cy="${y}" r="${dotR}" fill="#ff5555"/><title>${tip}</title>`;
      svg += `<text x="${x}" y="${y + 3.5}" text-anchor="middle" font-size="9" fill="#fff" font-weight="700" font-family="monospace" pointer-events="none">${note.finger}</text>`;
    } else {
      svg += `<circle cx="${x}" cy="${y}" r="${dotR}" fill="#1a1a1a" stroke="#ff5555" stroke-width="1.5"/><title>${tip}</title>`;
      svg += `<text x="${x}" y="${y + 3.5}" text-anchor="middle" font-size="9" fill="#ff5555" font-weight="600" font-family="monospace" pointer-events="none">${note.finger}</text>`;
    }
    svg += `</g>`;
  }

  svg += '</svg>';
  return svg;
}

async function updateFretboard() {
  const container = document.getElementById('fretboardContainer');
  if (!container) return;
  const root = document.getElementById('genRoot')?.value;
  const scale = document.getElementById('genScale')?.value;
  const position = document.getElementById('genPosition')?.value;
  const tuning = document.getElementById('genTuning')?.value;
  if (!root || !scale || !position || !tuning) return;

  container.innerHTML = '<div class="fretboard-label">Scale Shape</div><div class="fb-loading">Loading fretboard...</div>';

  try {
    const data = await fetchBoxPosition(root, scale, position, tuning);
    container.innerHTML = '<div class="fretboard-label">Scale Shape</div>' + buildFretboardSVG(data);
  } catch (e) {
    if (e.name === 'AbortError') return;
    container.innerHTML = '<div class="fretboard-label">Scale Shape</div><div class="fb-error">Could not load fretboard</div>';
  }
}

async function generateAndLoad() {
  const hasRatings = document.querySelectorAll('.session-item.rated').length > 0;
  if (hasRatings && !confirm('This will reset your current session. Continue?')) return;

  const btn = document.getElementById('genBtn');
  const status = document.getElementById('genStatus');
  btn.disabled = true;
  status.textContent = 'Generating exercise...';

  stopSectionPlayback();

  const pattern = document.getElementById('genPattern').value;
  const params = {
    root: document.getElementById('genRoot').value,
    scale: document.getElementById('genScale').value,
    pattern,
    position: parseInt(document.getElementById('genPosition').value) || 1,
    tuning: document.getElementById('genTuning').value,
    bars: parseInt(document.getElementById('genBars').value) || 4,
    tempo: parseInt(document.getElementById('genTempo').value) || 120,
  };

  if (pattern === 'sequence' || pattern === 'intervals') {
    params.direction = document.getElementById('genDirection').value;
  }
  if (pattern === 'sequence') {
    params.group_size = parseInt(document.getElementById('genGroupSize').value);
  }
  if (pattern === 'intervals') {
    params.interval_size = parseInt(document.getElementById('genIntervalSize').value);
  }
  if (pattern === 'string_skip') {
    params.skip = parseInt(document.getElementById('genSkip').value);
  }
  if (pattern === 'enclosure') {
    params.approach = document.getElementById('genApproach').value;
  }
  if (pattern === 'pentatonic_lick') {
    params.lick_name = document.getElementById('genLickName').value;
  }
  if (pattern === 'economy') {
    params.notes_per_string = parseInt(document.getElementById('genNotesPerString').value);
  }

  try {
    const resp = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = await resp.json();

    if (!data.ok) {
      status.textContent = 'Error: ' + (data.error || 'Unknown error');
      btn.disabled = false;
      return;
    }

    state.fileInfo = data.fileInfo;
    state.analyzeData = data.analyze;
    state.sessionData = data.session;
    state.progressData = data.progress;
    state.fileLoaded = true;
    state.selectedChunkId = null;
    state.playingChunkId = null;

    updateFileInfoBar();
    renderSessionTab();
    renderChunksTab();
    renderProgressTab();
    loadAlphaTabFile();

    status.textContent = `Loaded: ${data.filename}`;
    switchToTab('session');
  } catch (e) {
    status.textContent = 'Error: ' + e.message;
  }

  btn.disabled = false;
}

export async function initGenerateTab() {
  const pane = document.getElementById('pane-generate');

  let options;
  try {
    options = await fetch('/api/generate-options').then(r => r.json());
  } catch (e) {
    pane.innerHTML = '<div class="gen-empty">Could not reach exercise generator API.<br>Check your internet connection.</div>';
    return;
  }

  if (options.error) {
    pane.innerHTML = `<div class="gen-empty">API error: ${options.error}</div>`;
    return;
  }

  pane.innerHTML = `
    <div class="gen-form">
      <div class="gen-field">
        <label>Root Note</label>
        <select id="genRoot">${options.roots.map(r => `<option value="${r}"${r === 'E' ? ' selected' : ''}>${r}</option>`).join('')}</select>
      </div>
      <div class="gen-field">
        <label>Scale</label>
        <select id="genScale">${options.scales.map(s => `<option value="${s}"${s === 'pentatonic_minor' ? ' selected' : ''}>${s.replace(/_/g, ' ')}</option>`).join('')}</select>
      </div>
      <div class="gen-field">
        <label>Pattern</label>
        <select id="genPattern">${options.patterns.map(p => `<option value="${p}"${p === 'ascending' ? ' selected' : ''}>${p.replace(/_/g, ' ')}</option>`).join('')}</select>
      </div>

      <div class="gen-field gen-pattern-opt" id="opt-direction" style="display:none">
        <label>Direction</label>
        <select id="genDirection">
          <option value="ascending" selected>ascending</option>
          <option value="descending">descending</option>
        </select>
      </div>
      <div class="gen-field gen-pattern-opt" id="opt-group_size" style="display:none">
        <label>Group Size</label>
        <select id="genGroupSize">
          <option value="2">2</option>
          <option value="3" selected>3</option>
          <option value="4">4</option>
          <option value="5">5</option>
          <option value="6">6</option>
        </select>
      </div>
      <div class="gen-field gen-pattern-opt" id="opt-interval_size" style="display:none">
        <label>Interval</label>
        <select id="genIntervalSize">
          <option value="3" selected>3rds</option>
          <option value="4">4ths</option>
          <option value="5">5ths</option>
          <option value="6">6ths</option>
          <option value="8">octaves</option>
        </select>
      </div>
      <div class="gen-field gen-pattern-opt" id="opt-skip" style="display:none">
        <label>Strings to Skip</label>
        <select id="genSkip">
          <option value="1" selected>1</option>
          <option value="2">2</option>
          <option value="3">3</option>
        </select>
      </div>
      <div class="gen-field gen-pattern-opt" id="opt-approach" style="display:none">
        <label>Approach</label>
        <select id="genApproach">
          <option value="above_below" selected>above then below</option>
          <option value="below_above">below then above</option>
          <option value="above">above only</option>
          <option value="below">below only</option>
        </select>
      </div>
      <div class="gen-field gen-pattern-opt" id="opt-lick_name" style="display:none">
        <label>Lick Template</label>
        <select id="genLickName">
          <option value="bb_king_box" selected>BB King box</option>
          <option value="clapton_turnaround">Clapton turnaround</option>
          <option value="hendrix_hammer">Hendrix hammer</option>
          <option value="gilmour_bend">Gilmour bend</option>
          <option value="minor_pent_run">minor pent run</option>
        </select>
      </div>
      <div class="gen-field gen-pattern-opt" id="opt-notes_per_string" style="display:none">
        <label>Notes per String</label>
        <select id="genNotesPerString">
          <option value="1">1</option>
          <option value="2" selected>2</option>
          <option value="3">3</option>
          <option value="4">4</option>
        </select>
      </div>

      <div class="gen-field">
        <label>Position</label>
        <select id="genPosition">
          <option value="1">1 (E shape / open)</option>
          <option value="2">2 (D shape)</option>
          <option value="3" selected>3 (C shape)</option>
          <option value="4">4 (A shape)</option>
          <option value="5">5 (G shape)</option>
        </select>
      </div>
      <div class="gen-field">
        <label>Tuning</label>
        <select id="genTuning">${options.tunings.map(t => `<option value="${t}"${t === 'standard' ? ' selected' : ''}>${t.replace(/_/g, ' ')}</option>`).join('')}</select>
      </div>
      <div class="gen-field">
        <label>Bars</label>
        <input type="number" id="genBars" value="4" min="1" max="32" step="1">
      </div>
      <div class="gen-field">
        <label>Tempo</label>
        <div class="gen-tempo-row">
          <input type="range" id="genTempo" min="40" max="240" value="120" step="5">
          <span class="tempo-val" id="genTempoVal">120</span>
        </div>
      </div>
      <div class="gen-field">
        <label>Preset</label>
        <div style="display:flex;gap:6px">
          <select id="genPreset" style="flex:1;background:#222;color:#ddd;border:1px solid #444;border-radius:4px;padding:6px 8px;font-size:13px;font-family:inherit">
            <option value="">-- none --</option>
          </select>
          <button class="gen-btn" id="savePresetBtn" style="padding:6px 10px;font-size:11px;background:#444;margin-top:0">Save</button>
          <button class="gen-btn" id="deletePresetBtn" style="padding:6px 10px;font-size:11px;background:#333;margin-top:0">Del</button>
        </div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="gen-btn" id="randomBtn" style="flex:0 0 auto;padding:10px 14px;background:#444;font-size:12px" title="Random root/scale/pattern/position">Surprise Me</button>
        <button class="gen-btn" id="genBtn" style="flex:1">Generate & Load</button>
      </div>
      <div class="gen-status" id="genStatus"></div>
      <div class="fretboard-container" id="fretboardContainer">
        <div class="fretboard-label">Scale Shape</div>
        <div class="fb-loading">Loading fretboard...</div>
      </div>
    </div>
  `;

  function updatePatternControls() {
    const pattern = document.getElementById('genPattern').value;
    const show = PATTERN_CONTROLS[pattern] || [];
    document.querySelectorAll('.gen-pattern-opt').forEach(el => {
      const key = el.id.replace('opt-', '');
      el.style.display = show.includes(key) ? '' : 'none';
    });
  }

  document.getElementById('genPattern').addEventListener('change', updatePatternControls);
  updatePatternControls();

  document.getElementById('genTempo').addEventListener('input', (e) => {
    document.getElementById('genTempoVal').textContent = e.target.value;
  });

  document.getElementById('genBtn').addEventListener('click', generateAndLoad);

  document.getElementById('randomBtn').addEventListener('click', () => {
    function pickRandom(selectId) {
      const sel = document.getElementById(selectId);
      if (!sel) return;
      const opts = Array.from(sel.options);
      sel.selectedIndex = Math.floor(Math.random() * opts.length);
    }
    pickRandom('genRoot');
    pickRandom('genScale');
    pickRandom('genPattern');
    pickRandom('genPosition');
    document.getElementById('genPattern').dispatchEvent(new Event('change'));
    updateFretboard();
  });

  // Presets (localStorage)
  const PRESET_KEY = 'practice_presets';

  function loadPresets() {
    try { return JSON.parse(localStorage.getItem(PRESET_KEY)) || {}; } catch { return {}; }
  }
  function savePresets(presets) { localStorage.setItem(PRESET_KEY, JSON.stringify(presets)); }

  function refreshPresetDropdown() {
    const sel = document.getElementById('genPreset');
    const presets = loadPresets();
    sel.innerHTML = '<option value="">-- none --</option>';
    for (const name of Object.keys(presets).sort()) {
      sel.innerHTML += `<option value="${name}">${name}</option>`;
    }
  }

  function getFormValues() {
    const vals = {};
    FORM_IDS.forEach(id => { vals[id] = document.getElementById(id)?.value; });
    return vals;
  }

  function applyFormValues(vals) {
    FORM_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el && vals[id] != null) el.value = vals[id];
    });
    document.getElementById('genTempoVal').textContent = document.getElementById('genTempo').value;
    document.getElementById('genPattern').dispatchEvent(new Event('change'));
    updateFretboard();
  }

  document.getElementById('savePresetBtn').addEventListener('click', () => {
    const name = prompt('Preset name:');
    if (!name) return;
    const presets = loadPresets();
    presets[name] = getFormValues();
    savePresets(presets);
    refreshPresetDropdown();
    document.getElementById('genPreset').value = name;
  });

  document.getElementById('deletePresetBtn').addEventListener('click', () => {
    const name = document.getElementById('genPreset').value;
    if (!name) return;
    const presets = loadPresets();
    delete presets[name];
    savePresets(presets);
    refreshPresetDropdown();
  });

  document.getElementById('genPreset').addEventListener('change', () => {
    const name = document.getElementById('genPreset').value;
    if (!name) return;
    const presets = loadPresets();
    if (presets[name]) applyFormValues(presets[name]);
  });

  refreshPresetDropdown();

  ['genRoot', 'genScale', 'genPosition', 'genTuning'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', updateFretboard);
  });
  updateFretboard();
}
