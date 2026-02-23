import state from './state.mjs';
import { switchToTab, initTabs, updateFileInfoBar } from './ui.mjs';
import { initAlphaTab, loadAlphaTabFile } from './alphatab-manager.mjs';
import { initPlayback } from './playback.mjs';
import { renderSessionTab } from './session-tab.mjs';
import { renderChunksTab } from './chunks-tab.mjs';
import { renderProgressTab } from './progress-tab.mjs';
import { initGenerateTab } from './generate-tab.mjs';
import { startSession, isRunnerActive } from './session-runner.mjs';

async function boot() {
  initAlphaTab();
  initTabs();
  initPlayback();
  await initGenerateTab();

  // Wire up Start Session button via event delegation (survives innerHTML replacement)
  document.getElementById('pane-session').addEventListener('click', (e) => {
    if (e.target.id === 'startSessionBtn') {
      if (!isRunnerActive() && state.fileLoaded) startSession();
    }
  });

  let infoResp;
  try {
    const r = await fetch('/api/file-info');
    infoResp = await r.json();
  } catch {
    infoResp = { error: 'Server unavailable' };
  }

  if (infoResp.error) {
    state.fileLoaded = false;
    document.getElementById('fileInfo').textContent = 'No file loaded';
    document.getElementById('pane-session').innerHTML = '<div class="gen-empty">Generate an exercise or start with a file to begin.</div>';
    document.getElementById('pane-chunks').innerHTML = '<div class="gen-empty">No file loaded.</div>';
    document.getElementById('pane-progress').innerHTML = '<div class="gen-empty">No file loaded.</div>';
    switchToTab('generate');
  } else {
    state.fileLoaded = true;
    state.fileInfo = infoResp;
    try {
      const [analyzeResp, sessionResp, progressResp] = await Promise.all([
        fetch('/api/analyze').then(r => r.json()),
        fetch('/api/session').then(r => r.json()),
        fetch('/api/progress').then(r => r.json()),
      ]);
      state.analyzeData = analyzeResp;
      state.sessionData = sessionResp;
      state.progressData = progressResp;

      updateFileInfoBar();
      renderSessionTab();
      renderChunksTab();
      renderProgressTab();
      loadAlphaTabFile();
    } catch (err) {
      console.error('[Practice] Failed to load session data:', err);
      document.getElementById('fileInfo').textContent = state.fileInfo.title || 'File loaded';
      document.getElementById('pane-session').innerHTML = '<div class="gen-empty">Failed to load session data. Try refreshing.</div>';
    }
  }
}

// Load alphaTab UMD, then boot
const script = document.createElement('script');
script.src = '/node_modules/@coderline/alphatab/dist/alphaTab.js';
script.onload = () => boot();
document.head.appendChild(script);
