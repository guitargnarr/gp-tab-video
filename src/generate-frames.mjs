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
  const sectionMarkers = opts.sectionMarkers || [];

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

  // Remove "rendered by alphaTab" watermark text from the strip.
  // The watermark appears below the staff content at the bottom of the strip,
  // and also past the last beat horizontally. We detect it by scanning from
  // the bottom up: find rows with content separated from the main staff by a gap.
  {
    // 1. Blank pixels past the last beat (horizontal watermark at end of strip)
    if (beatTimings.length > 0) {
      const lastBeatX = Math.ceil(beatTimings[beatTimings.length - 1].pixelX);
      const blankStart = Math.min(lastBeatX + 50, actualWidth);
      if (blankStart < actualWidth) {
        for (let y = 0; y < actualHeight; y++) {
          const rowStart = y * stripRowBytes + blankStart * channels;
          const rowEnd = y * stripRowBytes + actualWidth * channels;
          stripRaw.fill(0, rowStart, rowEnd);
        }
      }
    }

    // 2. Blank watermark text below the staff (vertical -- bottom of strip)
    // Scan rows bottom-up to find the lowest row with non-black pixels,
    // then find the gap between that text and the staff content above it.
    // Blank everything below the gap.
    const rowHasContent = (y) => {
      // Sample every 5px across first 500px (watermark is always at the start)
      for (let x = 0; x < Math.min(500, actualWidth); x += 5) {
        const offset = y * stripRowBytes + x * channels;
        const r = stripRaw[offset], g = stripRaw[offset + 1], b = stripRaw[offset + 2], a = stripRaw[offset + 3];
        if (a > 10 && (r > 30 || g > 30 || b > 30)) return true;
      }
      return false;
    };

    // Find the bottom-most row with any content
    let bottomContentRow = -1;
    for (let y = actualHeight - 1; y >= 0; y--) {
      if (rowHasContent(y)) { bottomContentRow = y; break; }
    }

    if (bottomContentRow > 0) {
      // Scan upward from the watermark text to find the gap (empty rows)
      let gapTop = bottomContentRow;
      for (let y = bottomContentRow; y >= 0; y--) {
        if (!rowHasContent(y)) {
          // Found start of gap -- check if there's content above (the staff)
          let staffAbove = false;
          for (let y2 = y - 1; y2 >= Math.max(0, y - 20); y2--) {
            if (rowHasContent(y2)) { staffAbove = true; break; }
          }
          if (staffAbove) {
            gapTop = y;
            break;
          }
        }
      }

      // Blank everything from gapTop down
      if (gapTop < actualHeight) {
        for (let y = gapTop; y < actualHeight; y++) {
          const rowStart = y * stripRowBytes;
          const rowEnd = rowStart + stripRowBytes;
          stripRaw.fill(0, rowStart, rowEnd);
        }
      }
    }
  }

  // Pre-render section marker labels onto the strip (one-time cost).
  // Burns text directly into the raw pixel buffer so the frame loop stays fast.
  if (sectionMarkers.length > 0) {
    const labelHeight = 20;
    const fontSize = 14;
    const padding = 6;

    for (const marker of sectionMarkers) {
      const textWidth = marker.text.length * (fontSize * 0.62); // approximate
      const boxWidth = Math.ceil(textWidth + padding * 2);
      const boxHeight = labelHeight + padding;
      const startX = Math.round(marker.pixelX);

      if (startX < 0 || startX >= actualWidth) continue;

      // Render label as SVG -> raw RGBA via sharp
      const svg = `<svg width="${boxWidth}" height="${boxHeight}">
        <rect x="0" y="0" width="${boxWidth}" height="${boxHeight}" rx="3" fill="rgba(0,0,0,0.6)"/>
        <text x="${padding}" y="${fontSize + 2}" font-family="Helvetica,Arial,sans-serif" font-size="${fontSize}" font-weight="bold" fill="white">${escapeXml(marker.text)}</text>
      </svg>`;

      try {
        const labelBuf = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer();
        const labelW = boxWidth;
        const labelH = boxHeight;
        const yPos = 2; // near top of strip

        // Alpha-blend label onto strip raw pixels
        for (let ly = 0; ly < labelH && (yPos + ly) < actualHeight; ly++) {
          for (let lx = 0; lx < labelW && (startX + lx) < actualWidth; lx++) {
            const srcIdx = (ly * labelW + lx) * channels;
            const dstIdx = ((yPos + ly) * actualWidth + (startX + lx)) * channels;

            const sa = labelBuf[srcIdx + 3] / 255;
            if (sa === 0) continue;
            const ia = 1 - sa;

            stripRaw[dstIdx]     = Math.round(labelBuf[srcIdx] * sa + stripRaw[dstIdx] * ia);
            stripRaw[dstIdx + 1] = Math.round(labelBuf[srcIdx + 1] * sa + stripRaw[dstIdx + 1] * ia);
            stripRaw[dstIdx + 2] = Math.round(labelBuf[srcIdx + 2] * sa + stripRaw[dstIdx + 2] * ia);
            stripRaw[dstIdx + 3] = Math.min(255, Math.round(labelBuf[srcIdx + 3] + stripRaw[dstIdx + 3] * ia));
          }
        }
      } catch (e) {
        // Skip label on render failure (non-critical)
      }
    }
  }

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

function escapeXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
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
