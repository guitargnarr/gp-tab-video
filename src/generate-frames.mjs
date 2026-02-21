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
  const cursorWidth = opts.cursorWidth || 3;
  const cursorColor = opts.cursorColor || { r: 255, g: 50, b: 50 };

  const totalFrames = Math.ceil((songDurationMs / 1000) * fps);
  const cursorX = Math.floor(viewportWidth / 3);

  // Decode the strip once into raw RGBA pixels
  const stripImage = sharp(stripPngBuffer).ensureAlpha();
  const stripMeta = await stripImage.metadata();
  const actualWidth = stripMeta.width;
  const actualHeight = stripMeta.height;
  const stripRaw = await stripImage.raw().toBuffer();
  const channels = 4; // RGBA
  const stripRowBytes = actualWidth * channels;

  const viewportHeight = actualHeight;

  // Fallback pixel mapping
  if (beatTimings.length > 0 && beatTimings[0].barProgress !== undefined) {
    for (const bt of beatTimings) {
      bt.pixelX = Math.round(bt.barProgress * actualWidth);
    }
  }

  // Pre-allocate output frame buffer
  const frameSize = viewportWidth * viewportHeight * channels;
  const frameBuffer = Buffer.alloc(frameSize);

  // Pre-compute cursor column pixels
  const cursorStartCol = cursorX - 1;
  const cursorEndCol = cursorX + cursorWidth + 1;
  const cursorCoreStart = cursorX;
  const cursorCoreEnd = cursorX + cursorWidth;

  for (let frame = 0; frame < totalFrames; frame++) {
    const timeMs = (frame / fps) * 1000;
    const scrollX = interpolateX(beatTimings, timeMs);

    let cropX = Math.round(scrollX - cursorX);
    cropX = Math.max(0, Math.min(cropX, actualWidth - viewportWidth));

    const cropW = Math.min(viewportWidth, actualWidth - cropX);

    // Copy pixels row by row from strip into frame buffer
    for (let y = 0; y < viewportHeight; y++) {
      const srcOffset = y * stripRowBytes + cropX * channels;
      const dstOffset = y * viewportWidth * channels;

      // Copy the visible portion
      stripRaw.copy(frameBuffer, dstOffset, srcOffset, srcOffset + cropW * channels);

      // Fill remaining width with transparent black if strip narrower than viewport
      if (cropW < viewportWidth) {
        frameBuffer.fill(0, dstOffset + cropW * channels, dstOffset + viewportWidth * channels);
      }
    }

    // Draw cursor with glow (column-based, in-place)
    for (let y = 0; y < viewportHeight; y++) {
      const rowOffset = y * viewportWidth * channels;

      // Glow (wider, semi-transparent)
      for (let x = cursorStartCol; x < cursorEndCol && x < viewportWidth; x++) {
        if (x < 0) continue;
        const px = rowOffset + x * channels;
        const isCore = x >= cursorCoreStart && x < cursorCoreEnd;
        const alpha = isCore ? 230 : 77; // 0.9 vs 0.3

        // Alpha blend: out = src * alpha + dst * (1 - alpha)
        const a = alpha / 255;
        const ia = 1 - a;
        frameBuffer[px] = Math.round(cursorColor.r * a + frameBuffer[px] * ia);
        frameBuffer[px + 1] = Math.round(cursorColor.g * a + frameBuffer[px + 1] * ia);
        frameBuffer[px + 2] = Math.round(cursorColor.b * a + frameBuffer[px + 2] * ia);
        frameBuffer[px + 3] = Math.max(frameBuffer[px + 3], alpha);
      }
    }

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

  const progress = (timeMs - current.ms) / (next.ms - current.ms);
  return current.pixelX + (next.pixelX - current.pixelX) * progress;
}
