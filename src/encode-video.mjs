import { spawn } from 'child_process';

const FFMPEG = '/opt/homebrew/bin/ffmpeg';

/**
 * @param {string} outputPath
 * @param {number} width
 * @param {number} height
 * @param {number} fps
 * @param {boolean} transparent
 * @param {object} platformOpts - platform-specific encoding options
 * @param {string} platformOpts.videoBitrate - e.g. '8M', '12M', '45M'
 * @param {string} platformOpts.audioBitrate - e.g. '256k', '384k'
 * @param {number} platformOpts.audioSampleRate - e.g. 48000
 */
export function createEncoder(outputPath, width, height, fps, transparent = true, platformOpts = {}) {
  // H.264 yuv420p requires even dimensions
  const w = width % 2 === 0 ? width : width + 1;
  const h = height % 2 === 0 ? height : height + 1;

  // Use pad filter to handle odd->even dimension adjustment
  const needsPad = w !== width || h !== height;

  let args;

  if (transparent && outputPath.endsWith('.mov')) {
    args = [
      '-y',
      '-f', 'rawvideo',
      '-pixel_format', 'rgba',
      '-video_size', `${width}x${height}`,
      '-framerate', `${fps}`,
      '-i', 'pipe:0',
      ...(needsPad ? ['-vf', `pad=${w}:${h}:0:0:black@0`] : []),
      '-c:v', 'prores_ks',
      '-profile:v', '4444',
      '-pix_fmt', 'yuva444p10le',
      '-vendor', 'apl0',
      outputPath,
    ];
  } else if (transparent && outputPath.endsWith('.webm')) {
    args = [
      '-y',
      '-f', 'rawvideo',
      '-pixel_format', 'rgba',
      '-video_size', `${width}x${height}`,
      '-framerate', `${fps}`,
      '-i', 'pipe:0',
      '-c:v', 'libvpx-vp9',
      '-pix_fmt', 'yuva420p',
      '-b:v', platformOpts.videoBitrate || '2M',
      outputPath,
    ];
  } else {
    // H.264 MP4 -- use platform bitrate if provided, otherwise CRF 18
    const useBitrate = !!platformOpts.videoBitrate;
    args = [
      '-y',
      '-f', 'rawvideo',
      '-pixel_format', 'rgba',
      '-video_size', `${width}x${height}`,
      '-framerate', `${fps}`,
      '-i', 'pipe:0',
      '-vf', `pad=${w}:${h}:0:0:black`,
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      // Platform preset: use target bitrate for exact spec compliance
      // Default: use CRF for quality-based encoding (smaller files)
      ...(useBitrate
        ? ['-b:v', platformOpts.videoBitrate, '-maxrate', platformOpts.videoBitrate, '-bufsize', platformOpts.videoBitrate]
        : ['-crf', '18']),
      outputPath,
    ];
  }

  const ffmpeg = spawn(FFMPEG, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stderrData = '';
  let processExited = false;

  ffmpeg.stderr.on('data', (chunk) => {
    stderrData += chunk.toString();
  });

  ffmpeg.on('exit', () => {
    processExited = true;
  });

  return {
    write(frameBuffer) {
      if (processExited) return Promise.resolve();
      return new Promise((resolve, reject) => {
        if (!ffmpeg.stdin.writable) {
          resolve();
          return;
        }
        const canContinue = ffmpeg.stdin.write(frameBuffer, (err) => {
          if (err) reject(err);
        });
        if (canContinue) resolve();
        else ffmpeg.stdin.once('drain', resolve);
      });
    },

    async finish() {
      return new Promise((resolve, reject) => {
        ffmpeg.stdin.end();
        ffmpeg.on('close', (code) => {
          if (code !== 0) {
            reject(
              new Error(`ffmpeg exited with code ${code}\n${stderrData.slice(-500)}`)
            );
          } else {
            resolve();
          }
        });
        ffmpeg.on('error', reject);
      });
    },
  };
}
