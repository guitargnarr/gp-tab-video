#!/usr/bin/env node
/**
 * analyze-audio.mjs -- Extract per-frame audio energy for visualization
 *
 * Uses ffmpeg to compute RMS energy at configurable frame intervals.
 * Returns a normalized energy array (0.0-1.0) that drives visual parameters.
 *
 * Usage:
 *   import { analyzeAudio } from './analyze-audio.mjs';
 *   const { energy, duration, sampleRate, fps } = await analyzeAudio('audio.wav', { fps: 30 });
 */

import { execFileSync } from 'child_process';

/**
 * Extract per-frame RMS energy from an audio file.
 *
 * @param {string} audioPath - Path to audio file (WAV, MP3, FLAC, M4A)
 * @param {object} opts
 * @param {number} opts.fps - Frames per second (default: 30)
 * @param {number} opts.smoothing - Smoothing window in frames (default: 3)
 * @returns {{ energy: Float32Array, peak: number, duration: number, fps: number }}
 */
export async function analyzeAudio(audioPath, opts = {}) {
  const fps = opts.fps || 30;
  const smoothing = opts.smoothing || 3;

  // Get duration
  const durationStr = execFileSync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'csv=p=0',
    audioPath,
  ], { encoding: 'utf-8' }).trim();
  const duration = parseFloat(durationStr);
  const totalFrames = Math.ceil(duration * fps);

  // Extract raw PCM samples (mono, 16-bit, native sample rate)
  const pcmBuffer = execFileSync('ffmpeg', [
    '-i', audioPath,
    '-ac', '1',           // mono
    '-f', 's16le',        // raw 16-bit signed little-endian
    '-acodec', 'pcm_s16le',
    '-v', 'error',
    '-',                  // stdout
  ], { maxBuffer: 500 * 1024 * 1024 }); // 500MB max

  // Get actual sample rate
  const srStr = execFileSync('ffprobe', [
    '-v', 'error',
    '-select_streams', 'a:0',
    '-show_entries', 'stream=sample_rate',
    '-of', 'csv=p=0',
    audioPath,
  ], { encoding: 'utf-8' }).trim();
  const sampleRate = parseInt(srStr, 10);

  // Convert buffer to samples
  const numSamples = pcmBuffer.length / 2;
  const samples = new Int16Array(pcmBuffer.buffer, pcmBuffer.byteOffset, numSamples);

  // Compute RMS per frame
  const samplesPerFrame = Math.floor(sampleRate / fps);
  const rawEnergy = new Float32Array(totalFrames);

  for (let f = 0; f < totalFrames; f++) {
    const start = f * samplesPerFrame;
    const end = Math.min(start + samplesPerFrame, numSamples);
    if (start >= numSamples) break;

    let sumSq = 0;
    const count = end - start;
    for (let i = start; i < end; i++) {
      const normalized = samples[i] / 32768;
      sumSq += normalized * normalized;
    }
    rawEnergy[f] = Math.sqrt(sumSq / count);
  }

  // Smooth with moving average
  const energy = new Float32Array(totalFrames);
  const halfWindow = Math.floor(smoothing / 2);
  for (let f = 0; f < totalFrames; f++) {
    let sum = 0;
    let count = 0;
    for (let w = -halfWindow; w <= halfWindow; w++) {
      const idx = f + w;
      if (idx >= 0 && idx < totalFrames) {
        sum += rawEnergy[idx];
        count++;
      }
    }
    energy[f] = sum / count;
  }

  // Find peak for normalization
  let peak = 0;
  for (let f = 0; f < totalFrames; f++) {
    if (energy[f] > peak) peak = energy[f];
  }

  // Normalize to 0.0-1.0
  if (peak > 0) {
    for (let f = 0; f < totalFrames; f++) {
      energy[f] /= peak;
    }
  }

  // Generate slow energy channel (heavy exponential smoothing for macro behavior)
  // Attack: fast rise (~200ms), Release: slow decay (~2s)
  const energySlow = new Float32Array(totalFrames);
  const attackCoeff = 1 - Math.exp(-1 / (fps * 0.2));   // ~200ms attack
  const releaseCoeff = 1 - Math.exp(-1 / (fps * 2.0));  // ~2s release
  energySlow[0] = energy[0];
  for (let f = 1; f < totalFrames; f++) {
    const coeff = energy[f] > energySlow[f - 1] ? attackCoeff : releaseCoeff;
    energySlow[f] = energySlow[f - 1] + coeff * (energy[f] - energySlow[f - 1]);
  }

  // Generate glacial energy channel (very slow, ~5s envelope for large-scale evolution)
  const energyGlacial = new Float32Array(totalFrames);
  const glacialCoeff = 1 - Math.exp(-1 / (fps * 5.0));  // ~5s time constant
  energyGlacial[0] = energy[0];
  for (let f = 1; f < totalFrames; f++) {
    energyGlacial[f] = energyGlacial[f - 1] + glacialCoeff * (energy[f] - energyGlacial[f - 1]);
  }

  return { energy, energySlow, energyGlacial, peak, duration, fps, totalFrames, sampleRate };
}

// CLI mode
if (import.meta.url === `file://${process.argv[1]}`) {
  const audioPath = process.argv[2];
  if (!audioPath) {
    console.error('Usage: node src/analyze-audio.mjs <audio-file> [fps]');
    process.exit(1);
  }
  const fps = parseInt(process.argv[3], 10) || 30;

  const result = await analyzeAudio(audioPath, { fps });
  console.log(`Audio: ${audioPath}`);
  console.log(`Duration: ${result.duration.toFixed(1)}s`);
  console.log(`Sample rate: ${result.sampleRate} Hz`);
  console.log(`Frames: ${result.totalFrames} @ ${fps} fps`);
  console.log(`Peak RMS: ${result.peak.toFixed(4)}`);

  // Print energy blocks (10-second chunks)
  const framesPerBlock = fps * 10;
  console.log('\nEnergy profile (10s blocks):');
  for (let i = 0; i < result.totalFrames; i += framesPerBlock) {
    const end = Math.min(i + framesPerBlock, result.totalFrames);
    let avg = 0;
    for (let f = i; f < end; f++) avg += result.energy[f];
    avg /= (end - i);
    const bar = '#'.repeat(Math.round(avg * 40));
    const time = `${(i / fps).toFixed(0)}s`.padStart(5);
    console.log(`  ${time} |${bar.padEnd(40)}| ${(avg * 100).toFixed(0)}%`);
  }
}
