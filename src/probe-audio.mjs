/**
 * Probe an audio file using ffprobe. Returns metadata without decoding.
 */
import { execSync } from 'child_process';
import * as fs from 'fs';

const FFPROBE = '/opt/homebrew/bin/ffprobe';

export function probeAudio(audioPath) {
  if (!fs.existsSync(audioPath)) {
    throw new Error(`Audio file not found: ${audioPath}`);
  }

  const cmd = `${FFPROBE} -v quiet -print_format json -show_format -show_streams "${audioPath}"`;
  let result;
  try {
    result = JSON.parse(execSync(cmd, { encoding: 'utf8' }));
  } catch (e) {
    throw new Error(`Failed to probe audio file: ${e.message}`);
  }

  const audioStream = result.streams.find(s => s.codec_type === 'audio');
  if (!audioStream) {
    throw new Error(`No audio stream found in ${audioPath}`);
  }

  return {
    duration: parseFloat(result.format.duration),
    sampleRate: parseInt(audioStream.sample_rate, 10),
    channels: audioStream.channels,
    codec: audioStream.codec_name,
    bitDepth: audioStream.bits_per_raw_sample || audioStream.bits_per_sample,
    channelLayout: audioStream.channel_layout || (audioStream.channels === 2 ? 'stereo' : 'mono'),
  };
}
