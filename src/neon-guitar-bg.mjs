/**
 * Neon Guitar Sign background animation renderer.
 * Ported from greater-guitars NeonGuitarHero.tsx (Canvas 2D).
 * Renders frames as raw RGBA buffers for piping to ffmpeg.
 */
import { createCanvas } from '@napi-rs/canvas';

// Electric guitar outline — normalized 0-1 coordinates
const GUITAR_PATHS = [
  // Treble horn (right, taller)
  [[0.55,0.55],[0.60,0.52],[0.63,0.46],[0.64,0.38],[0.62,0.30],[0.58,0.24],[0.55,0.22]],
  // Neck (right side)
  [[0.55,0.22],[0.54,0.17],[0.54,0.11],[0.54,0.06]],
  // Headstock
  [[0.54,0.06],[0.56,0.045],[0.58,0.03],[0.565,0.015],[0.50,0.005],[0.435,0.015],[0.42,0.03],[0.44,0.045],[0.46,0.06]],
  // Neck (left side)
  [[0.46,0.06],[0.46,0.11],[0.46,0.17],[0.45,0.22]],
  // Bass horn (left, shorter)
  [[0.45,0.22],[0.42,0.24],[0.38,0.30],[0.36,0.38],[0.37,0.46],[0.40,0.52],[0.45,0.55]],
  // Waist left
  [[0.45,0.55],[0.38,0.58],[0.30,0.62],[0.26,0.68]],
  // Lower body left
  [[0.26,0.68],[0.25,0.76],[0.30,0.84],[0.38,0.89]],
  // Bottom
  [[0.38,0.89],[0.44,0.92],[0.50,0.93],[0.56,0.92],[0.62,0.89]],
  // Lower body right
  [[0.62,0.89],[0.70,0.84],[0.75,0.76],[0.74,0.68]],
  // Waist right
  [[0.74,0.68],[0.70,0.62],[0.62,0.58],[0.55,0.55]],
  // Bridge
  [[0.38,0.78],[0.62,0.78]],
  // Neck pickup
  [[0.42,0.52],[0.58,0.52]],
  // Bridge pickup
  [[0.36,0.68],[0.64,0.68]],
];

// Neon colors in HSL
const NEON_GREEN = [120, 100, 55];
const NEON_YELLOW = [58, 100, 55];

function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xFFFFFFFF;
    return (s >>> 0) / 0xFFFFFFFF;
  };
}

export function createNeonRenderer(width, height, fps) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const rand = seededRandom(42);

  // Initialize segment flicker states
  const segments = GUITAR_PATHS.map((_, i) => ({
    brightness: 0.7 + rand() * 0.3,
    targetBrightness: 1,
    flickerTimer: 0,
    flickerDuration: 0,
    nextFlicker: Math.floor(30 + rand() * 120),
    broken: false,
    brokenTimer: 0,
    colorIndex: i % 3 === 0 ? 1 : 0, // mix green and yellow
  }));

  let surgeTimer = 0;
  let frameCount = 0;

  // Scale guitar to fit viewport
  const guitarAspect = 0.34 / 0.85;
  const maxH = height * 0.75;
  const maxW = width * 0.5;
  let scale;
  if (maxW / guitarAspect < maxH) {
    scale = maxW / 0.34;
  } else {
    scale = maxH / 0.85;
  }
  const offsetX = (width - scale * 1) / 2;
  const offsetY = (height - scale * 0.88) / 2 - scale * 0.02;

  function getColor(seg, alpha) {
    const [h, s, l] = seg.colorIndex === 0 ? NEON_GREEN : NEON_YELLOW;
    return `hsla(${h}, ${s}%, ${l}%, ${alpha * seg.brightness})`;
  }

  function drawNeonPath(points, seg) {
    if (points.length < 2) return;

    const mapX = (x) => x * scale + offsetX;
    const mapY = (y) => y * scale + offsetY;

    const passes = [
      { width: 16, alpha: 0.08 },
      { width: 8, alpha: 0.2 },
      { width: 2.5, alpha: 0.9 },
    ];

    for (const pass of passes) {
      ctx.beginPath();
      ctx.moveTo(mapX(points[0][0]), mapY(points[0][1]));

      for (let i = 1; i < points.length - 1; i++) {
        const cpx = mapX(points[i][0]);
        const cpy = mapY(points[i][1]);
        const nx = mapX(points[i + 1][0]);
        const ny = mapY(points[i + 1][1]);
        ctx.quadraticCurveTo(cpx, cpy, (cpx + nx) / 2, (cpy + ny) / 2);
      }
      const last = points[points.length - 1];
      ctx.lineTo(mapX(last[0]), mapY(last[1]));

      ctx.strokeStyle = getColor(seg, pass.alpha);
      ctx.lineWidth = pass.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
  }

  return {
    renderFrame() {
      frameCount++;
      const t = frameCount;

      // Clear
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#0c0a08';
      ctx.fillRect(0, 0, width, height);

      // Surge
      surgeTimer -= 1;
      const isSurge = surgeTimer > 0;
      if (t % 180 === 0 && rand() > 0.4) {
        surgeTimer = 4 + Math.floor(rand() * 6);
      }

      // Update flicker states
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];

        if (isSurge) {
          seg.brightness = 0.95 + rand() * 0.05;
          continue;
        }

        if (seg.broken) {
          seg.brokenTimer -= 1;
          seg.brightness = 0.05 + rand() * 0.08;
          if (seg.brokenTimer <= 0) {
            seg.broken = false;
            seg.brightness = 0.9;
          }
          continue;
        }

        if (seg.flickerTimer > 0) {
          seg.flickerTimer -= 1;
          seg.brightness = seg.targetBrightness + (rand() - 0.5) * 0.1;
          if (seg.flickerTimer <= 0) {
            seg.brightness = 0.8 + rand() * 0.2;
          }
        } else {
          seg.nextFlicker -= 1;
          seg.brightness += (0.85 - seg.brightness) * 0.05 + (rand() - 0.5) * 0.02;
          seg.brightness = Math.max(0.6, Math.min(1, seg.brightness));

          if (seg.nextFlicker <= 0) {
            if (rand() < 0.08) {
              seg.broken = true;
              seg.brokenTimer = 60 + Math.floor(rand() * 200);
            } else {
              seg.targetBrightness = 0.1 + rand() * 0.3;
              seg.flickerDuration = 3 + Math.floor(rand() * 12);
              seg.flickerTimer = seg.flickerDuration;
            }
            seg.nextFlicker = 30 + Math.floor(rand() * 150);
          }
        }
      }

      // Draw with additive blending
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < GUITAR_PATHS.length; i++) {
        drawNeonPath(GUITAR_PATHS[i], segments[i]);
      }
      ctx.globalCompositeOperation = 'source-over';

      // Ambient haze
      const cx = width / 2;
      const cy = height * 0.45;
      const haze = ctx.createRadialGradient(cx, cy, 0, cx, cy, scale * 0.5);
      haze.addColorStop(0, 'rgba(100, 200, 80, 0.03)');
      haze.addColorStop(0.5, 'rgba(200, 200, 60, 0.015)');
      haze.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = haze;
      ctx.fillRect(0, 0, width, height);

      // Return raw RGBA pixel data
      const imageData = ctx.getImageData(0, 0, width, height);
      return Buffer.from(imageData.data);
    }
  };
}
