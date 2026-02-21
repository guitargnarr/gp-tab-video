# gp-tab-video

Generate scrolling guitar tab overlay videos from Guitar Pro files. The kind you see in metal playthrough videos on YouTube -- automated, no manual video editing required.

## What It Does

Takes any Guitar Pro file (.gp, .gp5, .gp4, .gp3, .gpx) and outputs a video of scrolling tablature with a red playhead cursor, synced to the song's tempo and timing.

Two output modes:
- **Standalone** (.mp4) -- white tabs on dark background, ready to watch
- **Transparent overlay** (.mov with alpha) -- ProRes 4444, drop into your NLE as a layer on top of playthrough footage

## Current State

Working prototype. Tested on GP7 files with up to 100 bars, 5 tracks, tempo changes.

**What works:**
- Reads GP3 through GP7 formats via alphaTab
- Renders tab-only horizontal strip (no standard notation)
- Beat-accurate timing with tempo change support
- Smooth scroll interpolation between beats at 30fps
- Red cursor at 1/3 viewport (2/3 look-ahead)
- White notation on dark or transparent background
- ProRes 4444 alpha output for video compositing
- ~3 min render time for a 3 min song

**Known limitations:**
- No audio track in output (sync manually in your editor, or use ffmpeg composite command below)
- Font registration (Roboto) causes segfault on Node 25 + alphaSkia -- using alphaTab's built-in font fallback instead
- No multi-track simultaneous rendering yet (one track per run)

## End Goal

A single CLI command that takes a Guitar Pro file and a playthrough video recording, and outputs a finished composite video with synced scrolling tab overlay -- ready to upload to YouTube. Future additions:

- Audio-synced compositing (detect BPM from audio, align tab to recording)
- Multi-track rendering (lead + rhythm side by side or color-coded)
- Customizable styling (colors, cursor shape, viewport width, font size)
- Technique annotations (P.M., hammer-on, pull-off, slides, bends)
- Section markers and bar numbers
- Browser-based preview mode before committing to full render

## Usage

```bash
# Install
cd ~/Projects/gp-tab-video
npm install

# Standalone video (white tabs on dark background)
node src/index.mjs song.gp

# Pick a specific track
node src/index.mjs song.gp 1

# Transparent overlay for compositing
node src/index.mjs song.gp 0 --transparent

# Custom output path
node src/index.mjs song.gp 0 output/my_video.mp4
```

### Composite Over Playthrough Footage

```bash
# Overlay tab at bottom 25% of your playthrough video
ffmpeg -i playthrough.mp4 -i output/song_tab.mov \
  -filter_complex "[1:v]scale=-1:ih*0.25[tab];[0:v][tab]overlay=0:H-h-20" \
  -c:v libx264 -crf 18 final.mp4
```

## Requirements

- Node.js 22+ (tested on 25.2.1)
- ffmpeg (tested on 8.0)
- macOS (alphaSkia native binary is platform-specific)

## Architecture

```
GP file
  |
  v
alphaTab ScoreLoader (parse any GP format)
  |
  v
alphaTab ScoreRenderer + alphaSkia (render horizontal PNG strip)
  |
  v
BoundsLookup (beat-to-pixel position map)
  |
  v
Timing engine (MIDI ticks -> milliseconds, handles tempo changes)
  |
  v
Frame generator (sharp crop + cursor overlay per frame at 30fps)
  |
  v
ffmpeg stdin pipe (raw RGBA -> ProRes 4444 or H.264)
  |
  v
.mov or .mp4
```

## Dependencies

- `@coderline/alphatab` -- GP file parsing + notation rendering
- `@coderline/alphaskia` + `alphaskia-macos` -- Skia-based PNG rendering
- `sharp` -- fast image crop/composite per frame
- ffmpeg -- video encoding (system install)
