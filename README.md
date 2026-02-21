# gp-tab-video

Generate scrolling guitar tab overlay videos from Guitar Pro files. The kind you see in metal playthrough videos on YouTube -- automated, no manual video editing required.

## What It Does

Takes any Guitar Pro file (.gp, .gp5, .gp4, .gp3, .gpx) and outputs a video of scrolling tablature with a playhead cursor, synced to the song's tempo and timing.

**Output modes:**
- **Standalone** (.mp4) -- white tabs on dark background
- **Transparent overlay** (.mov with alpha) -- ProRes 4444, drop into your NLE as a layer on top of playthrough footage
- **Direct composite** -- overlay tab onto playthrough footage in one command

**Platform presets** with optimized encoding for YouTube, YouTube Shorts, and Instagram Reels -- including vertical (9:16) output with safe zone awareness.

## Current State

Fully functional CLI tool. Renders a 3-min song in ~9 seconds at 30fps.

**Features:**
- Reads GP3 through GP7 formats via alphaTab
- Tab-only horizontal rendering (no standard notation clutter)
- Beat-accurate timing with tempo change support
- Smooth scroll interpolation between beats
- Cursor with glow at 1/3 viewport (2/3 look-ahead)
- White notation / light gray string lines on dark or transparent background
- Configurable FPS (24/30/60), resolution (1080p/4K), notation scale
- Multi-track stacked rendering (e.g., lead + rhythm guitar)
- One-command composite over playthrough footage via `--video`
- ProRes 4444 alpha output for NLE compositing
- Customizable cursor color and width
- Platform presets: YouTube, Instagram, Facebook, TikTok
- Vertical (9:16) video support with safe zone margins

## End Goal

The complete playthrough video pipeline: record in Logic (tempo/BPM), film on iPhone, run one command, get a YouTube-ready video with synced scrolling tab overlay. Remaining work:

- Technique annotations rendered on tab (P.M., H, P, slides, bends, whammy)
- Section markers / bar numbers overlay
- Per-track color coding in multi-track mode
- Browser-based live preview before committing to render
- Preset styles (dark mode, light mode, stream overlay, etc.)

## Usage

```bash
npm install

# Basic: standalone MP4 (white tabs, dark bg)
node src/index.mjs song.gp

# Specific track (0-indexed)
node src/index.mjs song.gp 1

# Transparent overlay for NLE compositing
node src/index.mjs song.gp 0 --transparent

# 4K 60fps with larger notation
node src/index.mjs song.gp 0 --width 3840 --fps 60 --scale 1.3

# Multi-track (lead + rhythm stacked)
node src/index.mjs song.gp 0,1

# Composite directly over playthrough footage
node src/index.mjs song.gp 0 --video playthrough.mp4

# Custom cursor
node src/index.mjs song.gp 0 --cursor-color cyan --cursor-width 4
```

### Platform Presets

One flag sets resolution, FPS, bitrate, and encoding to match each platform's optimal upload specs.

```bash
# YouTube standard (1920x1080, 30fps, H.264, 12Mbps, AAC 384kbps)
node src/index.mjs song.gp 0 --platform youtube

# YouTube 4K (3840x2160, 30fps, H.264, 45Mbps)
node src/index.mjs song.gp 0 --platform youtube-4k

# YouTube Shorts vertical (1080x1920, 30fps, 8Mbps)
node src/index.mjs song.gp 0 --platform youtube-shorts

# Instagram Reels vertical (1080x1920, 30fps, 6Mbps)
node src/index.mjs song.gp 0 --platform instagram

# Instagram Story (1080x1920, 60s segments, lower bitrate)
node src/index.mjs song.gp 0 --platform instagram-story

# Instagram Feed 4:5 portrait (1080x1350, max 90s)
node src/index.mjs song.gp 0 --platform instagram-feed

# Instagram Carousel (1080x1350, 60s/slide)
node src/index.mjs song.gp 0 --platform instagram-carousel

# Vertical + playthrough composite (tab above IG safe zone)
node src/index.mjs song.gp 0 --platform instagram --video playthrough.mp4
```

**YouTube:**

| Preset | Resolution | Aspect | Bitrate | Audio | Max Duration |
|--------|-----------|--------|---------|-------|-------------|
| `youtube` | 1920x1080 | 16:9 | 12 Mbps | AAC 384k | Unlimited |
| `youtube-4k` | 3840x2160 | 16:9 | 45 Mbps | AAC 384k | Unlimited |
| `youtube-shorts` | 1080x1920 | 9:16 | 8 Mbps | AAC 256k | 3 min |

**Instagram:**

| Preset | Resolution | Aspect | Bitrate | Max Duration | Safe Zone | Notes |
|--------|-----------|--------|---------|-------------|-----------|-------|
| `instagram` | 1080x1920 | 9:16 | 6 Mbps | 15 min | 320px bottom, 108px top | Permanent, appears in Reels tab + Explore |
| `instagram-story` | 1080x1920 | 9:16 | 4 Mbps | 60s/segment | 250px top AND bottom | 24hr lifespan, auto-splits longer videos |
| `instagram-feed` | 1080x1350 | 4:5 | 5 Mbps | 90s | 50px edges | Permanent, max feed real estate |
| `instagram-carousel` | 1080x1350 | 4:5 | 5 Mbps | 60s/slide | 50px edges | Up to 20 slides, all same aspect ratio |

All Instagram presets: 30fps, H.264, AAC 256kbps, 48kHz. File size: 4GB (Reels), 100MB (Stories/Feed).

**Facebook:**

As of June 2025, all Facebook videos are Reels -- there's no separate "feed video" format anymore.

| Preset | Resolution | Aspect | Bitrate | Max Duration | Safe Zone | Notes |
|--------|-----------|--------|---------|-------------|-----------|-------|
| `facebook` | 1080x1920 | 9:16 | 8 Mbps | No cap | 672px bottom (!), 269px top | All videos are Reels now. Bottom safe zone is massive (35%). |
| `facebook-story` | 1080x1920 | 9:16 | 6 Mbps | 20s/card, 2min total | 250px top and bottom | 24hr lifespan, splits at 15s |

All Facebook presets: 30fps, H.264, AAC 192kbps, 48kHz. File size: 4GB max.

**Facebook vs Instagram safe zone warning:** Facebook's bottom safe zone is 672px (35% of 1920) vs Instagram's 320px (17%). Tab overlay placement is significantly higher on Facebook. The `--platform facebook` preset handles this automatically when compositing with `--video`.

**TikTok:**

TikTok recompresses all uploads -- upload at high quality and let their encoder do its thing.

| Preset | Resolution | Aspect | Bitrate | Max Duration | Safe Zone | Notes |
|--------|-----------|--------|---------|-------------|-----------|-------|
| `tiktok` | 1080x1920 | 9:16 | 8 Mbps | 10 min (60 min upload) | 320px bottom, 108px top | Also 120px right (engagement buttons), 60px left. File: 287MB iOS, 72MB Android. |

30fps, H.264, AAC 256kbps, 48kHz. TikTok safe zone is 900x1492px centered in the 1080x1920 frame.

**TikTok vs Instagram:** Nearly identical safe zones (320px bottom, 108px top). Main differences: TikTok has a 120px right margin for engagement buttons (not an issue for bottom-positioned tab overlays), lower file size limits (287MB iOS vs 4GB), and heavier recompression on upload.

### All Options

```
node src/index.mjs <file.gp> [tracks] [output] [options]

Arguments:
  file.gp           Guitar Pro file (.gp, .gp5, .gp4, .gp3, .gpx)
  tracks            Track numbers, comma-separated (default: 0)
  output            Output path (.mov = ProRes alpha, .mp4 = H.264)

Options:
  --transparent     Alpha background for overlay compositing
  --fps N           Frame rate: 24, 30, 60 (default: 30)
  --width N         Viewport width in px (default: 1920, use 3840 for 4K)
  --video FILE      Playthrough footage -- composites tab overlay at bottom
  --tracks 0,1      Track indices to render (multi-track stacked)
  --scale N         Notation scale factor (default: 1.0)
  --cursor-color C  Cursor color: red, white, cyan, green, yellow, orange
  --cursor-width N  Cursor width in px (default: 3)
  --platform NAME   Platform preset (see table above)
  --vertical        9:16 vertical output (auto-set by platform presets)
```

CLI flags override preset values, so `--platform instagram --fps 60` uses all IG defaults but at 60fps.

## Intended Workflow

### YouTube (Horizontal Playthrough)

1. Write/arrange in Guitar Pro 7
2. Record guitar in Logic Pro (session tempo = GP file BPM)
3. Film playthrough horizontally on iPhone 16 Pro Max (4K 30fps, HDR OFF)
4. AirDrop or USB-C transfer to Mac
5. Run: `node src/index.mjs song.gp 0 --platform youtube --video playthrough.mp4`
6. Upload to YouTube

### Instagram Reels / YouTube Shorts (Vertical)

1. Write/arrange in Guitar Pro 7
2. Record guitar in Logic Pro
3. Film playthrough vertically on iPhone 16 Pro Max (4K 30fps, HDR OFF)
4. Transfer to Mac
5. Run: `node src/index.mjs song.gp 0 --platform instagram --video playthrough.mp4`
6. Upload to Instagram Reels (max 3 min, 1080x1920)

For YouTube Shorts, swap `--platform instagram` for `--platform youtube-shorts`.

### NLE Compositing (Premiere Pro / DaVinci Resolve)

For maximum control, generate the tab overlay separately and composite in your editor:

1. `node src/index.mjs song.gp 0 --platform youtube --transparent` (outputs ProRes 4444 .mov with alpha)
2. Open Premiere Pro 2026
3. V1: iPhone footage, V2: Logic audio (WAV 48kHz 24-bit), V3: Tab overlay .mov
4. Scale/position tab overlay at bottom of frame
5. Export: Match Source - High Bitrate, or use YouTube/IG presets

### iPhone 16 Pro Max Camera Settings

- **Formats:** HEVC (recommended) or Apple ProRes (max quality, needs external SSD)
- **Resolution:** 4K
- **Frame Rate:** 30fps (cinematic) or 60fps (fast playing). Match `--fps` flag.
- **HDR Video:** OFF (Rec.709 SDR avoids color mismatch with tab overlay)
- **Stabilization:** Standard (not Action Mode, which crops)
- **Grid:** ON (helps framing)

### Transfer to Mac

- **AirDrop** -- fastest for single clips
- **USB-C cable + Image Capture** -- best for multiple clips or ProRes (preserves original quality)
- **iCloud Photos** -- automatic but slower; export unmodified original from Photos

## Requirements

- Node.js 22+ (tested on 25.2.1)
- ffmpeg (tested on 8.0)
- macOS (alphaSkia native binary is platform-specific)

## Architecture

```
GP file
  |
  v
alphaTab ScoreLoader ---- parse any GP3-GP7 format
  |
  v
ScoreRenderer + alphaSkia ---- render horizontal PNG strip + BoundsLookup
  |
  v
Timing engine ---- MIDI ticks -> ms, tempo changes, beat-to-pixel map
  |
  v
Frame generator ---- raw pixel crop + cursor blend, ~600 frames/sec
  |
  v
ffmpeg stdin pipe ---- raw RGBA -> ProRes 4444 / H.264 (platform-optimized bitrate)
  |
  v
.mov or .mp4 (or direct composite with --video, vertical-aware for 9:16)
```

## Performance

| Scenario | Time |
|----------|------|
| 3 min song, 30fps, 1080p, single track | ~9s |
| 3 min song, 30fps, instagram preset (1080w) | ~16s |
| 3 min song, 60fps, 1080p, 1.3x scale | ~15s |
| 3 min song, 30fps, multi-track (2 tracks) | ~25s |

## Platform Spec Sources

- [YouTube recommended upload encoding settings](https://support.google.com/youtube/answer/1722171?hl=en)
- [YouTube Shorts dimensions guide (2026)](https://vidiq.com/blog/post/youtube-shorts-vertical-video/)
- [Instagram video size & format specs (2026)](https://socialrails.com/blog/instagram-video-size-format-specifications-guide)
- [Instagram safe zones (2026)](https://zeely.ai/blog/master-instagram-safe-zones/)
- [Instagram Reels dimensions (2026)](https://help.instagram.com/1038071743007909)
- [Instagram carousel sizes (2026)](https://www.overvisual.com/tools/instagram-carousel-size)
- [Facebook video size & specs (2026)](https://www.aiarty.com/knowledge-base/facebook-video-size.htm)
- [Facebook Reels dimensions (2026)](https://www.aiarty.com/knowledge-base/facebook-reel-size.htm)
- [Facebook Reels safe zones (2026)](https://sendshort.ai/guides/facebook-reels-size/)
- [TikTok video size & dimensions (2026)](https://fliki.ai/blog/tiktok-video-size)
- [TikTok safe zones (2026)](https://kreatli.com/guides/tiktok-safe-zone)

## Dependencies

- `@coderline/alphatab` -- GP file parsing + notation rendering
- `@coderline/alphaskia` + `alphaskia-macos` -- Skia-based PNG rendering
- `sharp` -- strip decode (one-time) + multi-track compositing
- ffmpeg -- video encoding (system install)
