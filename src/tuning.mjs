// Common guitar tuning patterns: MIDI note values -> human-readable name.
// MIDI notes: E2=40, A2=45, D3=50, G3=55, B3=59, E4=64
// Strings are ordered high to low in alphaTab (E4 first, E2 last for standard).

const STANDARD_6 = [64, 59, 55, 50, 45, 40]; // E Standard
const KNOWN_TUNINGS_6 = [
  { name: 'E Standard',   midi: [64, 59, 55, 50, 45, 40] },
  { name: 'Eb Standard',  midi: [63, 58, 54, 49, 44, 39] },
  { name: 'D Standard',   midi: [62, 57, 53, 48, 43, 38] },
  { name: 'C# Standard',  midi: [61, 56, 52, 47, 42, 37] },
  { name: 'C Standard',   midi: [60, 55, 51, 46, 41, 36] },
  { name: 'B Standard',   midi: [59, 54, 50, 45, 40, 35] },
  { name: 'Drop D',       midi: [64, 59, 55, 50, 45, 38] },
  { name: 'Drop C#',      midi: [63, 58, 54, 49, 44, 37] },
  { name: 'Drop C',       midi: [62, 57, 53, 48, 43, 36] },
  { name: 'Drop B',       midi: [61, 56, 52, 47, 42, 35] },
  { name: 'Drop A#',      midi: [60, 55, 51, 46, 41, 34] },
  { name: 'Drop A',       midi: [59, 54, 50, 45, 40, 33] },
  { name: 'DADGAD',       midi: [62, 57, 55, 50, 45, 38] },
  { name: 'Open D',       midi: [62, 57, 54, 50, 45, 38] },
  { name: 'Open G',       midi: [62, 59, 55, 50, 43, 38] },
  { name: 'Open E',       midi: [64, 59, 56, 52, 45, 40] },
  { name: 'Open A',       midi: [64, 61, 57, 52, 45, 40] },
  { name: 'Open C',       midi: [64, 60, 55, 48, 43, 36] },
];

const KNOWN_TUNINGS_7 = [
  { name: '7-String B Standard', midi: [64, 59, 55, 50, 45, 40, 35] },
  { name: '7-String Drop A',     midi: [64, 59, 55, 50, 45, 40, 33] },
  { name: '7-String A Standard', midi: [63, 58, 54, 49, 44, 39, 33] },
];

const KNOWN_TUNINGS_8 = [
  { name: '8-String F# Standard', midi: [64, 59, 55, 50, 45, 40, 35, 30] },
  { name: '8-String Drop E',      midi: [64, 59, 55, 50, 45, 40, 35, 28] },
];

const KNOWN_TUNINGS_4 = [
  { name: 'Bass Standard',  midi: [43, 38, 33, 28] },
  { name: 'Bass Drop D',    midi: [43, 38, 33, 26] },
  { name: 'Bass D Standard', midi: [41, 36, 31, 26] },
  { name: 'Bass Drop C',    midi: [41, 36, 31, 24] },
  { name: 'Bass C Standard', midi: [39, 34, 29, 24] },
];

const KNOWN_TUNINGS_5 = [
  { name: '5-String Bass Standard', midi: [43, 38, 33, 28, 23] },
  { name: '5-String Bass Hi-C',     midi: [48, 43, 38, 33, 28] },
];

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function midiToNote(midi) {
  const name = NOTE_NAMES[midi % 12];
  const octave = Math.floor(midi / 12) - 1;
  return name + octave;
}

/**
 * Detect tuning name from MIDI note values.
 * @param {number[]} tunings - MIDI note values, high string to low string
 * @param {number} stringCount - number of strings
 * @returns {{ name: string, notes: string }} e.g. { name: 'Drop D', notes: 'E4 B3 G3 D3 A2 D2' }
 */
export function detectTuning(tunings, stringCount) {
  if (!tunings || tunings.length === 0) {
    return { name: 'Unknown', notes: '' };
  }

  const notes = tunings.map(midiToNote).join(' ');

  // Try known tunings by string count
  let knownList;
  switch (stringCount || tunings.length) {
    case 4: knownList = KNOWN_TUNINGS_4; break;
    case 5: knownList = KNOWN_TUNINGS_5; break;
    case 6: knownList = KNOWN_TUNINGS_6; break;
    case 7: knownList = KNOWN_TUNINGS_7; break;
    case 8: knownList = KNOWN_TUNINGS_8; break;
    default: knownList = [];
  }

  for (const known of knownList) {
    if (known.midi.length === tunings.length &&
        known.midi.every((v, i) => v === tunings[i])) {
      return { name: known.name, notes };
    }
  }

  // Check if it's a uniform offset from E Standard (6-string)
  if (tunings.length === 6) {
    const offsets = tunings.map((v, i) => v - STANDARD_6[i]);
    if (offsets.every(o => o === offsets[0]) && offsets[0] !== 0) {
      const semitones = offsets[0];
      const dir = semitones > 0 ? 'up' : 'down';
      return { name: `E Standard ${dir} ${Math.abs(semitones)} semitone${Math.abs(semitones) > 1 ? 's' : ''}`, notes };
    }
  }

  return { name: 'Custom', notes };
}
