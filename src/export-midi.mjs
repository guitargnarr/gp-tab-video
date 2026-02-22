#!/usr/bin/env node
/**
 * export-midi.mjs -- Export Guitar Pro file to standard MIDI (.mid)
 *
 * Usage:
 *   node src/export-midi.mjs <file.gp> [output.mid]
 */

import { loadScore } from './load-score.mjs';
import * as alphaTab from '@coderline/alphatab';
import * as fs from 'fs';
import * as path from 'path';

const gpFile = process.argv[2];
const outputArg = process.argv[3];

if (!gpFile) {
  console.error('Usage: node src/export-midi.mjs <file.gp> [output.mid]');
  process.exit(1);
}

const gpPath = path.resolve(gpFile);
if (!fs.existsSync(gpPath)) {
  console.error(`File not found: ${gpPath}`);
  process.exit(1);
}

console.log(`Loading ${path.basename(gpPath)}...`);
const { score, settings } = await loadScore(gpPath);

console.log(`  Title: ${score.title || '(untitled)'}`);
console.log(`  Tracks: ${score.tracks.map((t, i) => `[${i}] ${t.name}`).join(', ')}`);
console.log(`  Bars: ${score.masterBars.length}`);
console.log(`  Tempo: ${score.tempo} BPM`);

// Create MIDI file (Type 1 = multi-track, best for DAW import)
const midiFile = new alphaTab.midi.MidiFile();
midiFile.format = alphaTab.midi.MidiFileFormat.MultiTrack;
midiFile.division = 960;

const handler = new alphaTab.midi.AlphaSynthMidiFileHandler(midiFile, true);
const generator = new alphaTab.midi.MidiFileGenerator(score, settings, handler);
generator.generate();

// Export
const binary = midiFile.toBinary();
const outputPath = outputArg
  ? path.resolve(outputArg)
  : path.resolve('output', path.basename(gpPath, path.extname(gpPath)) + '.mid');

const outputDir = path.dirname(outputPath);
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

fs.writeFileSync(outputPath, Buffer.from(binary));
const sizeKb = Math.round(fs.statSync(outputPath).size / 1024);
console.log(`\nExported: ${outputPath} (${sizeKb} KB)`);
console.log(`  Format: SMF Type 1 (multi-track)`);
console.log(`  PPQ: 960`);
console.log(`\nOpen with: open '${outputPath}'`);
