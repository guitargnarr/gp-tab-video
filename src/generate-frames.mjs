import sharp from 'sharp';

export async function* generateFrames(
  stripPngBuffer,
  beatTimings,
  songDurationMs,
  stripWidth,
  stripHeight,
  opts = {}
) {
  const fps = opts.fps || 30;
  const viewportWidth = opts.viewportWidth || 1920;
  const viewportHeight = stripHeight;
  const cursorWidth = opts.cursorWidth || 3;

  const totalFrames = Math.ceil((songDurationMs / 1000) * fps);
  // Cursor at 1/3 from left -- gives 2/3 look-ahead for upcoming notes
  const cursorX = Math.floor(viewportWidth / 3);

  // Get actual strip dimensions from the image
  const stripMeta = await sharp(stripPngBuffer).metadata();
  const actualWidth = stripMeta.width;
  const actualHeight = stripMeta.height;

  // If beatTimings need pixel mapping (fallback mode), apply linear mapping
  if (beatTimings.length > 0 && beatTimings[0].barProgress !== undefined) {
    for (const bt of beatTimings) {
      bt.pixelX = Math.round(bt.barProgress * actualWidth);
    }
  }

  // Pre-create cursor overlay SVG (red vertical line)
  const cursorSvg = Buffer.from(
    `<svg width="${viewportWidth}" height="${viewportHeight}">
       <rect x="${cursorX}" y="0" width="${cursorWidth}" height="${viewportHeight}"
             fill="rgba(255, 50, 50, 0.9)"/>
     </svg>`
  );

  for (let frame = 0; frame < totalFrames; frame++) {
    const timeMs = (frame / fps) * 1000;

    // Interpolate scroll X position from beat timings
    const scrollX = interpolateX(beatTimings, timeMs);

    // Center viewport so cursor is at cursorX
    let cropX = Math.round(scrollX - cursorX);
    cropX = Math.max(0, Math.min(cropX, actualWidth - viewportWidth));

    // Handle case where strip is narrower than viewport
    const cropW = Math.min(viewportWidth, actualWidth - cropX);

    const frameBuffer = await sharp(stripPngBuffer)
      .extract({
        left: cropX,
        top: 0,
        width: cropW,
        height: actualHeight,
      })
      .resize(viewportWidth, viewportHeight, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .composite([{ input: cursorSvg, top: 0, left: 0 }])
      .ensureAlpha()
      .raw()
      .toBuffer();

    yield {
      frame,
      timeMs,
      buffer: frameBuffer,
      width: viewportWidth,
      height: viewportHeight,
    };
  }
}

function interpolateX(beatTimings, timeMs) {
  if (beatTimings.length === 0) return 0;
  if (timeMs <= beatTimings[0].ms) return beatTimings[0].pixelX;
  if (timeMs >= beatTimings[beatTimings.length - 1].ms) {
    return beatTimings[beatTimings.length - 1].pixelX;
  }

  // Binary search for the beat just before or at timeMs
  let lo = 0;
  let hi = beatTimings.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (beatTimings[mid].ms <= timeMs) lo = mid;
    else hi = mid - 1;
  }

  const current = beatTimings[lo];
  const next = beatTimings[Math.min(lo + 1, beatTimings.length - 1)];

  if (current === next || current.ms === next.ms) return current.pixelX;

  // Linear interpolation between beat positions for smooth scrolling
  const progress = (timeMs - current.ms) / (next.ms - current.ms);
  return current.pixelX + (next.pixelX - current.pixelX) * progress;
}
