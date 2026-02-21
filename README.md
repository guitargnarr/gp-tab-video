# gp-tab-video

Generate scrolling guitar tab overlay videos from Guitar Pro files. The kind you see in metal playthrough videos on YouTube -- automated, no manual video editing required.

## What It Does

Takes any Guitar Pro file (.gp, .gp5, .gp4, .gp3, .gpx) and outputs a video of scrolling tablature with a playhead cursor, synced to the song's tempo and timing.

**Output modes:**
- **Standalone** (.mp4) -- white tabs on dark background
- **Transparent overlay** (.mov with alpha) -- ProRes 4444, drop into your NLE as a layer on top of playthrough footage
- **Direct composite** -- overlay tab onto playthrough footage in one command

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
```

## Intended Workflow

1. Write/arrange in Guitar Pro 7
2. Record guitar in Logic Pro (tempo set in session)
3. Film playthrough on iPhone 16 Pro Max
4. Run: `node src/index.mjs song.gp 0 --video playthrough.mp4 --fps 60`
5. Upload to YouTube

The GP file's BPM matches your Logic session. The tab video starts at beat 1 bar 1 -- align to downbeat in your editor, or let `--video` handle compositing.

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
ffmpeg stdin pipe ---- raw RGBA -> ProRes 4444 / H.264
  |
  v
.mov or .mp4 (or direct composite with --video)
```

## Performance

| Scenario | Time |
|----------|------|
| 3 min song, 30fps, 1080p, single track | ~9s |
| 3 min song, 60fps, 1080p, 1.3x scale | ~15s |
| 3 min song, 30fps, multi-track (2 tracks) | ~25s |

## Dependencies

- `@coderline/alphatab` -- GP file parsing + notation rendering
- `@coderline/alphaskia` + `alphaskia-macos` -- Skia-based PNG rendering
- `sharp` -- strip decode (one-time) + multi-track compositing
- ffmpeg -- video encoding (system install)
