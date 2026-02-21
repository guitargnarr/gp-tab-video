# gp-tab-video

Generate scrolling guitar tab overlay videos from Guitar Pro files. The kind you see in ERRA/Jackson Guitars playthrough videos -- automated, no manual video editing required.

## How It Started

Manual workflow: export tabs as images from Guitar Pro, import into Premiere Pro, manually position and keyframe scroll animation frame by frame, render, re-do when timing is off. Hours of tedious work per video.

## How It's Going

One command. GP file in, scrolling tab video out. A 3-minute song renders in ~9 seconds.

```bash
node src/index.mjs song.gp 0 --style playthrough --platform youtube --video playthrough.mp4
```

**What this does:**
1. Parses the GP file (any format: GP3, GP4, GP5, GP6, GP7, GPX)
2. Renders a horizontal tab strip with beat-accurate pixel positions
3. Generates scrolling frames with a glowing cursor synced to tempo
4. Composites the tab overlay onto your iPhone playthrough footage
5. Outputs a platform-optimized MP4 ready for upload

## Current Features

### Rendering
- Tab-only horizontal rendering (standard notation hidden)
- 5 ERRA-inspired track color palettes: white (lead), pink (rhythm), cyan (harmony), gold (bass), green
- Multi-track stacked rendering with per-track colors and 4px gap
- Beat-accurate cursor with configurable color and glow
- Cursor positioned at 1/3 viewport width (2/3 look-ahead)
- Watermark removal (alphaTab attribution stripped from pixel data)
- Configurable notation scale (1.0x default, 1.3-1.5x for larger tab numbers)

### Style Presets
Control what notation elements appear with `--style`:

| Style | What Shows | What's Hidden | Strip Height* |
|-------|-----------|---------------|---------------|
| `default` | Everything | Nothing | 550px |
| `clean` | All techniques + bar numbers | Title, tuning, track names, tempo, triplet feel | 527px |
| `playthrough` | P.M., H/P, bends, harmonics, vibrato, dynamics, bar numbers | Metadata, fingering, capo, lyrics, pedals | 527px |
| `minimal` | Tab numbers and staff lines only | All annotations | 469px |

*Heights from test file at 1.0x scale. Varies by song complexity.

### Notation Toggles
Fine-grained control with `--hide` and `--show`:

| Category | Elements |
|----------|----------|
| Metadata | title, subtitle, artist, album, words, music, copyright |
| Track | tuning, trackNames, chordDiagrams, barNumbers |
| Techniques | palmMute, letRing, tap, harmonics, vibrato, wideVibrato, bend, whammyBar, pickStroke, pickSlide, trill, fingering, barre, rasgueado, golpe, leftHandTap |
| Expression | dynamics, crescendo, fadeIn |
| Structure | tempo, marker, text, lyrics, chordNames, fermata, freeTime, tripletFeel, alternateEndings, repeatCount, directions |
| Pedals | wahPedal, sustainPedal |

`--hide` is additive (hide specific elements on top of a style). `--show` is exclusive (hide everything except listed elements).

### Output Modes
- **Standalone** (.mp4) -- colored tabs on dark background, ready to watch
- **Transparent overlay** (.mov ProRes 4444 with alpha) -- drop into Premiere/Resolve as a layer
- **Direct composite** -- overlay tab onto playthrough footage in one command via `--video`

### Platform Presets
One flag sets resolution, FPS, bitrate, audio codec, and safe zone margins:

**YouTube:**

| Preset | Resolution | Aspect | Bitrate | Audio | Max Duration |
|--------|-----------|--------|---------|-------|-------------|
| `youtube` | 1920x1080 | 16:9 | 12 Mbps | AAC 384k | Unlimited |
| `youtube-4k` | 3840x2160 | 16:9 | 45 Mbps | AAC 384k | Unlimited |
| `youtube-shorts` | 1080x1920 | 9:16 | 8 Mbps | AAC 256k | 3 min |

**Instagram:**

| Preset | Resolution | Aspect | Bitrate | Max Duration | Safe Zone |
|--------|-----------|--------|---------|-------------|-----------|
| `instagram` | 1080x1920 | 9:16 | 6 Mbps | 15 min | 320px bottom, 108px top |
| `instagram-story` | 1080x1920 | 9:16 | 4 Mbps | 60s/segment | 250px top and bottom |
| `instagram-feed` | 1080x1350 | 4:5 | 5 Mbps | 90s | 50px edges |
| `instagram-carousel` | 1080x1350 | 4:5 | 5 Mbps | 60s/slide | 50px edges |

**Facebook:**

| Preset | Resolution | Aspect | Bitrate | Max Duration | Safe Zone |
|--------|-----------|--------|---------|-------------|-----------|
| `facebook` | 1080x1920 | 9:16 | 8 Mbps | No cap | 672px bottom, 269px top |
| `facebook-story` | 1080x1920 | 9:16 | 6 Mbps | 20s/card | 250px top and bottom |

Facebook's bottom safe zone is 672px (35%) vs Instagram's 320px (17%). Tab placement is handled automatically per preset.

**TikTok:**

| Preset | Resolution | Aspect | Bitrate | Max Duration | Safe Zone |
|--------|-----------|--------|---------|-------------|-----------|
| `tiktok` | 1080x1920 | 9:16 | 8 Mbps | 10 min | 320px bottom, 108px top, 120px right |

### Section Markers
Sections defined in the GP file (Intro, Verse, Chorus, etc.) are automatically detected and rendered as labeled overlays at the top of the tab strip. No configuration needed -- if the file has sections, they appear.

### Tuning Detection
Automatically identifies tunings from MIDI note values and displays them in the CLI output:
```
Track 0 tuning: E Standard (E4 B3 G3 D3 A2 E2)
Track 1 tuning: Drop D (E4 B3 G3 D3 A2 D2)
```
Covers standard and alternate tunings for 4-8 string instruments, with fallback to uniform-offset detection ("E Standard down 2 semitones") for non-standard tunings.

### Browser Preview
Live preview with alphaTab's built-in MIDI player, cursor, and scrolling:
```bash
node src/preview.mjs song.gp                    # auto-opens browser
node src/preview.mjs song.gp --tracks 0,2 3000  # pre-select tracks, custom port
```
- Color-coded track toggle chips (click to add/remove tracks)
- Horizontal and page layout modes
- Play/pause/stop with scroll-on-play
- Drag-and-drop file loading

### Batch Rendering
Render multiple files and/or multiple platform outputs in one command:
```bash
node src/batch.mjs ~/compositions/*.gp --style playthrough
node src/batch.mjs ~/compositions/ --platform youtube,instagram --tracks 0
node src/batch.mjs song1.gp song2.gp5 --style clean --fps 60
```
Directories are scanned for GP files automatically. Platform comma-separation produces one output per file per platform.

### Composite Reels
Generate social media reels with cinematic background video behind the scrolling tab:
```bash
# Built-in neon guitar animation background
node src/composite-reel.mjs song.gp --start-bar 69 --duration 15 --platform instagram

# Stock footage composite (via ffmpeg)
ffmpeg -i ocean_bg.mp4 -ss 125.5 -t 15 -i tab_overlay.mov \
  -filter_complex "[0:v]...[bg];[bg][1:v]overlay=..." output.mp4
```
The composite-reel pipeline handles background rendering, tab overlay generation, alpha compositing, color grading, and platform-spec encoding in one pass. Supports `--bg neon-guitar` (built-in Canvas 2D animation) or external video via ffmpeg.

### Video Encoding
- H.264 for .mp4 (standalone or composite)
- ProRes 4444 for .mov (transparent alpha channel)
- Platform-aware bitrate targeting (ABR mode when preset active, CRF 18 otherwise)
- AAC audio with platform-specific bitrate and sample rate

### Performance

| Scenario | Time |
|----------|------|
| 3 min song, 30fps, 1080p, single track | ~9s |
| 3 min song, 30fps, 1080p, multi-track (2 tracks) | ~25s |
| 3 min song, 60fps, 1080p | ~15s |

Frame generation runs at ~600 frames/sec. The bottleneck is ffmpeg encoding, not frame generation.

## Usage

```bash
npm install

# Basic standalone
node src/index.mjs song.gp

# Specific track
node src/index.mjs song.gp 1

# Multi-track (lead + rhythm stacked, auto-colored)
node src/index.mjs song.gp 0,1

# Transparent overlay for NLE
node src/index.mjs song.gp 0 --transparent

# Composite over playthrough footage
node src/index.mjs song.gp 0 --video playthrough.mp4

# Platform-optimized
node src/index.mjs song.gp 0 --platform youtube
node src/index.mjs song.gp 0 --platform instagram --video playthrough.mp4

# Style presets
node src/index.mjs song.gp 0 --style playthrough
node src/index.mjs song.gp 0 --style minimal

# Notation toggles
node src/index.mjs song.gp 0 --hide tuning,trackNames,barNumbers
node src/index.mjs song.gp 0 --show palmMute,harmonics

# 4K with larger notation
node src/index.mjs song.gp 0 --width 3840 --fps 60 --scale 1.3

# Custom cursor
node src/index.mjs song.gp 0 --cursor-color cyan --cursor-width 4

# Kitchen sink: playthrough style, YouTube preset, composite over footage
node src/index.mjs song.gp 0 --style playthrough --platform youtube --video playthrough.mp4
```

### All Options

```
node src/index.mjs <file.gp> [tracks] [output] [options]

Arguments:
  file.gp           Guitar Pro file (.gp, .gp5, .gp4, .gp3, .gpx)
  tracks            Track numbers, comma-separated (default: 0)
  output            Output path (.mov = ProRes alpha, .mp4 = H.264)

Rendering:
  --transparent     Alpha background for overlay compositing
  --fps N           Frame rate: 24, 30, 60 (default: 30)
  --width N         Viewport width in px (default: 1920, use 3840 for 4K)
  --scale N         Notation scale factor (default: 1.0, try 1.3-1.5)
  --cursor-color C  red, white, cyan, green, yellow, orange (default: red)
  --cursor-width N  Cursor width in px (default: 3)
  --tracks 0,1      Track indices to render (multi-track stacked)

Style:
  --style NAME      Style preset: default, clean, playthrough, minimal
  --hide LIST       Hide notation elements (comma-separated)
  --show LIST       Show ONLY these elements (hides everything else)

Platform:
  --platform NAME   Platform preset (sets resolution, bitrate, safe zones)
  --vertical        Force 9:16 vertical output
  --video FILE      Playthrough footage to composite tab overlay onto
```

CLI flags override preset values: `--platform instagram --fps 60` uses IG defaults but at 60fps.

## Intended Workflow

### YouTube (Horizontal Playthrough)

1. Write/arrange in Guitar Pro 7
2. Record guitar in Logic Pro (session tempo = GP file BPM)
3. Film playthrough horizontally on iPhone 16 Pro Max (4K 30fps, HDR OFF)
4. AirDrop or USB-C transfer to Mac
5. `node src/index.mjs song.gp 0 --style playthrough --platform youtube --video playthrough.mp4`
6. Upload to YouTube

### Instagram Reels / YouTube Shorts (Vertical)

1. Film playthrough vertically
2. `node src/index.mjs song.gp 0 --style playthrough --platform instagram --video playthrough.mp4`
3. Upload -- tab overlay is positioned above the platform safe zone automatically

### NLE Compositing (Premiere Pro / DaVinci Resolve)

For maximum control, render the tab overlay separately:

1. `node src/index.mjs song.gp 0 --style playthrough --transparent` (ProRes 4444 .mov)
2. Import into Premiere/Resolve as V3 layer over footage
3. Scale/position to taste, apply color grading, export

### After Effects Automation (aerender)

The transparent .mov overlay can be composited headlessly using After Effects:

```bash
# Render tab overlay
node src/index.mjs song.gp 0 --transparent --style playthrough

# Composite via AE template + aerender (no GUI)
"/Applications/Adobe After Effects 2026/aerender" \
  -project template.aep -comp "Main" -output final.mp4
```

### iPhone 16 Pro Max Camera Settings

- **Resolution:** 4K
- **Frame Rate:** 30fps (cinematic) or 60fps (fast playing)
- **HDR Video:** OFF (Rec.709 SDR avoids color mismatch with tab overlay)
- **Format:** HEVC (recommended) or Apple ProRes (max quality, needs SSD)
- **Stabilization:** Standard (not Action Mode)
- **Grid:** ON

## Roadmap

Completed features are checked. Remaining work toward the full automated playthrough pipeline:

- [x] GP3-GP7 file parsing via alphaTab
- [x] Horizontal tab strip rendering with beat-accurate pixel positions
- [x] Tempo change support in timing engine
- [x] Smooth scroll interpolation between beats
- [x] Cursor with glow effect
- [x] Standalone .mp4 and transparent .mov (ProRes 4444) output
- [x] Multi-track stacked rendering
- [x] Per-track ERRA-style color palettes (white, pink, cyan, gold, green)
- [x] Direct composite over playthrough footage (`--video`)
- [x] Platform presets (YouTube, Shorts, Instagram, Facebook, TikTok)
- [x] Vertical 9:16 output with platform-aware safe zones
- [x] Watermark removal
- [x] Style presets (default, clean, playthrough, minimal)
- [x] 56 notation element toggles (`--hide`, `--show`)
- [x] Configurable FPS, resolution, scale, cursor color/width
- [x] 18x performance optimization (~600 frames/sec)
- [x] Section marker text overlay during playback (Intro, Verse, Chorus)
- [x] Tuning info display (detect and label Drop D, E Standard, etc.)
- [x] Browser-based live preview with multi-track color-coded toggle
- [x] Batch rendering (multiple songs, multiple platforms in one run)
- [x] Composite reel pipeline (background video/animation + tab overlay)
- [ ] AE template automation (ExtendScript + aerender pipeline)
- [ ] Audio sync from Logic Pro export (WAV alignment with GP file BPM)

## Architecture

```
GP file (.gp/.gp5/.gpx)
  |
  v
load-score.mjs --------- alphaTab ScoreLoader, auto-detects format
  |
  v
render-strip.mjs -------- ScoreRenderer + alphaSkia -> horizontal PNG strip
  |                        + style presets, notation toggles, color palettes
  |                        + BoundsLookup (beat pixel positions)
  v
build-timing.mjs -------- MIDI ticks -> ms (handles tempo changes)
  |                        + section marker extraction with pixel positions
  |                        formula: ms = ticks * (60000 / (bpm * 960))
  v
generate-frames.mjs ----- raw pixel crop from strip + cursor alpha blend
  |                        + watermark removal (horizontal + vertical)
  |                        + section marker label rendering (SVG -> pixel burn)
  |                        ~600 frames/sec throughput
  v
encode-video.mjs -------- ffmpeg stdin pipe (raw RGBA -> ProRes 4444 / H.264)
  |                        platform-aware bitrate, audio codec, sample rate
  v
index.mjs --------------- CLI orchestrator, arg parser, composite pipeline
  |                        multi-track stacking via sharp, tuning detection
  |
  +-- batch.mjs ---------- Multi-file/multi-platform batch rendering
  +-- composite-reel.mjs - Background video/animation + tab overlay compositing
  |                        + neon-guitar-bg.mjs (Canvas 2D animation renderer)
  +-- preview.mjs -------- HTTP server + browser UI (alphaTab player)
  |                        + multi-track color-coded toggle chips
  v
.mov or .mp4 (or composite reel with cinematic background)
```

## Requirements

- Node.js 22+ (tested on 25.2.1)
- ffmpeg 7+ (tested on 8.0)
- macOS (alphaSkia native binary is platform-specific)

## Dependencies

- `@coderline/alphatab` -- GP file parsing + notation rendering engine
- `@coderline/alphaskia` + `alphaskia-macos` -- Skia-based PNG rendering
- `sharp` -- strip decode + multi-track compositing
- `@napi-rs/canvas` -- headless Canvas 2D for background animation rendering
- ffmpeg -- video encoding (system install)

## Platform Spec Sources

- [YouTube upload encoding settings](https://support.google.com/youtube/answer/1722171)
- [YouTube Shorts dimensions](https://vidiq.com/blog/post/youtube-shorts-vertical-video/)
- [Instagram video specs (2026)](https://socialrails.com/blog/instagram-video-size-format-specifications-guide)
- [Instagram safe zones (2026)](https://zeely.ai/blog/master-instagram-safe-zones/)
- [Instagram carousel sizes](https://www.overvisual.com/tools/instagram-carousel-size)
- [Facebook video specs (2026)](https://www.aiarty.com/knowledge-base/facebook-video-size.htm)
- [Facebook Reels specs (2026)](https://www.aiarty.com/knowledge-base/facebook-reel-size.htm)
- [Facebook Reels safe zones](https://sendshort.ai/guides/facebook-reels-size/)
- [TikTok video specs (2026)](https://fliki.ai/blog/tiktok-video-size)
- [TikTok safe zones (2026)](https://kreatli.com/guides/tiktok-safe-zone)
