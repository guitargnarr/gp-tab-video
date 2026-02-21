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

  // Extract section markers with pixel positions and timing
  const sectionMarkers = buildSectionMarkers(score, boundsLookup, tickToMs);

  return { beatTimings, songDurationMs, tickToMs, sectionMarkers };
}

/**
 * Extract section markers (Intro, Verse, Chorus, etc.) with pixel X positions and timing.
 * Only includes markers that have non-empty text.
 */
function buildSectionMarkers(score, boundsLookup, tickToMs) {
  const markers = [];
  const system = boundsLookup?.staffSystems?.[0];
  if (!system) return markers;

  for (let i = 0; i < score.masterBars.length; i++) {
    const mb = score.masterBars[i];
    if (!mb.section) continue;

    const text = (mb.section.text || mb.section.marker || '').trim();
    if (!text) continue;

    // Find the pixel X position for this bar
    const barBounds = system.bars[i];
    if (!barBounds) continue;

    const pixelX = barBounds.visualBounds.x;
    const ms = tickToMs(mb.start);

    // Find the end of this section (start of next section or end of song)
    let endMs = tickToMs(score.masterBars[score.masterBars.length - 1].start +
      score.masterBars[score.masterBars.length - 1].calculateDuration());
    let endPixelX = system.bars[system.bars.length - 1].visualBounds.x +
      system.bars[system.bars.length - 1].visualBounds.w;

    for (let j = i + 1; j < score.masterBars.length; j++) {
      const nextMb = score.masterBars[j];
      if (nextMb.section) {
        const nextText = (nextMb.section.text || nextMb.section.marker || '').trim();
        if (nextText) {
          endMs = tickToMs(nextMb.start);
          const nextBarBounds = system.bars[j];
          if (nextBarBounds) endPixelX = nextBarBounds.visualBounds.x;
          break;
        }
      }
    }

    markers.push({
      text,
      barIndex: i,
      barNumber: i + 1,
      pixelX,
      endPixelX,
      ms,
      endMs,
    });
  }

  return markers;
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
