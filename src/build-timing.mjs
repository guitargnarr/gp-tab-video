const QUARTER_TIME = 960; // MIDI ticks per quarter note (alphaTab standard)

export function buildTimingMap(score, boundsLookup, trackIndex = 0) {
  // Build tempo map from masterBar tempo automations
  const tempoChanges = [{ tick: 0, bpm: score.tempo }];

  for (const masterBar of score.masterBars) {
    if (masterBar.tempoAutomation) {
      tempoChanges.push({
        tick: masterBar.start,
        bpm: masterBar.tempoAutomation.value,
      });
    }
  }
  tempoChanges.sort((a, b) => a.tick - b.tick);

  // Convert absolute tick to absolute milliseconds, accounting for tempo changes
  function tickToMs(targetTick) {
    let ms = 0;
    let prevTick = 0;
    let bpm = tempoChanges[0].bpm;

    for (let i = 1; i < tempoChanges.length; i++) {
      const tc = tempoChanges[i];
      if (tc.tick >= targetTick) break;
      ms += ((tc.tick - prevTick) / QUARTER_TIME) * (60000 / bpm);
      bpm = tc.bpm;
      prevTick = tc.tick;
    }
    ms += ((targetTick - prevTick) / QUARTER_TIME) * (60000 / bpm);
    return ms;
  }

  const beatTimings = [];

  if (boundsLookup && boundsLookup.staffSystems && boundsLookup.staffSystems.length > 0) {
    // Use only the first staffSystem (horizontal mode duplicates across systems)
    const system = boundsLookup.staffSystems[0];
    // system.bars[] = MasterBarBounds (one per bar)
    // system.bars[i].bars[] = BarBounds (one per track-staff in this bar)
    // system.bars[i].bars[j].beats[] = BeatBounds
    for (const masterBarBounds of system.bars) {
      for (const barBounds of masterBarBounds.bars) {
        for (const beatBound of barBounds.beats) {
          const beat = beatBound.beat;
          if (!beat) continue;

          const tick = beat.absolutePlaybackStart;
          const ms = tickToMs(tick);

          beatTimings.push({
            ms,
            tick,
            pixelX: beatBound.onNotesX,
          });
        }
      }
    }
  } else {
    // Fallback: estimate from score model
    console.warn('BoundsLookup not available. Using linear estimation.');
    return buildTimingFromScoreModel(score, trackIndex, tickToMs);
  }

  beatTimings.sort((a, b) => a.ms - b.ms);

  // Compute total song duration
  const lastMasterBar = score.masterBars[score.masterBars.length - 1];
  const songEndTick = lastMasterBar.start + lastMasterBar.calculateDuration();
  const songDurationMs = tickToMs(songEndTick);

  return { beatTimings, songDurationMs, tickToMs };
}

function buildTimingFromScoreModel(score, trackIndex, tickToMs) {
  const beatTimings = [];
  const track = score.tracks[trackIndex];

  let barIndex = 0;
  for (const masterBar of score.masterBars) {
    const bar = track.staves[0]?.bars[barIndex];
    if (bar) {
      for (const voice of bar.voices) {
        for (const beat of voice.beats) {
          const tick = beat.absolutePlaybackStart;
          const ms = tickToMs(tick);
          const progress = barIndex / score.masterBars.length;
          beatTimings.push({ ms, tick, pixelX: 0, barProgress: progress });
        }
      }
    }
    barIndex++;
  }

  beatTimings.sort((a, b) => a.ms - b.ms);

  const lastMasterBar = score.masterBars[score.masterBars.length - 1];
  const songEndTick = lastMasterBar.start + lastMasterBar.calculateDuration();
  const songDurationMs = tickToMs(songEndTick);

  return { beatTimings, songDurationMs, tickToMs, needsPixelMapping: true };
}
