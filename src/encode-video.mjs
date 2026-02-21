import { spawn } from 'child_process';

const FFMPEG = '/opt/homebrew/bin/ffmpeg';

export function createEncoder(outputPath, width, height, fps, transparent = true) {
  let args;

  if (transparent && outputPath.endsWith('.mov')) {
    // ProRes 4444 with alpha -- best for Final Cut / DaVinci compositing
    args = [
      '-y',
      '-f', 'rawvideo',
      '-pixel_format', 'rgba',
      '-video_size', `${width}x${height}`,
      '-framerate', `${fps}`,
      '-i', 'pipe:0',
      '-c:v', 'prores_ks',
      '-profile:v', '4444',
      '-pix_fmt', 'yuva444p10le',
      '-vendor', 'apl0',
      outputPath,
    ];
  } else if (transparent && outputPath.endsWith('.webm')) {
    // VP9 with alpha -- smaller file, web-compatible
    args = [
      '-y',
      '-f', 'rawvideo',
      '-pixel_format', 'rgba',
      '-video_size', `${width}x${height}`,
      '-framerate', `${fps}`,
      '-i', 'pipe:0',
      '-c:v', 'libvpx-vp9',
      '-pix_fmt', 'yuva420p',
      '-b:v', '2M',
      outputPath,
    ];
  } else {
    // H.264 standalone (no alpha, dark background)
    args = [
      '-y',
      '-f', 'rawvideo',
      '-pixel_format', 'rgba',
      '-video_size', `${width}x${height}`,
      '-framerate', `${fps}`,
      '-i', 'pipe:0',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-crf', '18',
      outputPath,
    ];
  }

  const ffmpeg = spawn(FFMPEG, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stderrData = '';
  ffmpeg.stderr.on('data', (chunk) => {
    stderrData += chunk.toString();
  });

  return {
    write(frameBuffer) {
      return new Promise((resolve, reject) => {
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
