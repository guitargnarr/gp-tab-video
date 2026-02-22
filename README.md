# gp-tab-video

Generate scrolling guitar tab overlay videos from Guitar Pro files. GP file in, playthrough-ready video out -- no manual video editing required.

```bash
node src/index.mjs song.gp 0 --style playthrough --platform youtube --video playthrough.mp4
```

1. Parses any GP format (GP3, GP4, GP5, GP6, GP7, GPX)
2. Renders a horizontal tab strip with beat-accurate pixel positions
3. Generates scrolling frames with a glowing cursor synced to tempo
4. Composites onto playthrough footage or a designed template
5. Outputs a platform-optimized video ready for upload

## Quick Start

```bash
npm install

# Standalone tab video (dark background)
node src/index.mjs song.gp

# Composite over iPhone playthrough footage
node src/index.mjs song.gp 0 --style playthrough --platform youtube --video playthrough.mp4

# Portrait reel for Instagram/TikTok
node src/index.mjs song.gp 0 --style playthrough --template reel-title --title "Song" --artist "Artist"

# Transparent overlay for Premiere/Resolve
node src/index.mjs song.gp 0 --transparent

# Browser preview with MIDI playback
node src/preview.mjs song.gp
```

## All Options

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

Compositing:
  --video FILE      Playthrough footage to composite tab overlay onto
  --template T      Template compositor (JSON file or built-in name)
  --title TEXT      Song title for template text layers
  --artist TEXT     Artist name for template text layers

Audio:
  --audio FILE      Audio file (WAV/MP3/FLAC) to mux into the output
                    With --video: replaces footage audio with this file

Platform:
  --platform NAME   Platform preset (sets resolution, bitrate, safe zones)
  --vertical        Force 9:16 vertical output
```

CLI flags override preset values: `--platform instagram --fps 60` uses IG defaults but at 60fps.

## Output Modes

| Mode | Command | Output |
|------|---------|--------|
| Standalone | `node src/index.mjs song.gp` | .mp4 -- tab on dark background |
| Transparent overlay | `--transparent` | .mov ProRes 4444 with alpha |
| Footage composite | `--video playthrough.mp4` | .mp4 -- tab over iPhone footage |
| Template composite | `--template cinematic-title` | .mp4 -- tab + background + text + effects |
| Portrait reel | `--template reel` | .mp4 -- 1080x1920 for IG/TikTok |

## Style Presets

Control what notation elements appear with `--style`:

| Style | What Shows | What's Hidden |
|-------|-----------|---------------|
| `default` | Everything | Nothing |
| `clean` | All techniques + bar numbers | Title, tuning, track names, tempo, triplet feel |
| `playthrough` | P.M., H/P, bends, harmonics, vibrato, dynamics, bar numbers | Metadata, fingering, capo, lyrics, pedals |
| `minimal` | Tab numbers and staff lines only | All annotations |

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

## Platform Presets

One flag sets resolution, FPS, bitrate, audio codec, and safe zone margins.

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

**TikTok:**

| Preset | Resolution | Aspect | Bitrate | Max Duration | Safe Zone |
|--------|-----------|--------|---------|-------------|-----------|
| `tiktok` | 1080x1920 | 9:16 | 8 Mbps | 10 min | 320px bottom, 108px top, 120px right |

Facebook's bottom safe zone is 672px (35%) vs Instagram's 320px (17%). Tab placement is handled automatically per preset.

## Template Compositor

Composite the tab overlay onto a designed template with background, text, and effects -- pure ffmpeg, no external software:

```bash
# Via index.mjs (one command):
node src/index.mjs song.gp 0 --style playthrough --template cinematic-title --title "My Song" --artist "Artist"

# Via compositor.mjs (standalone, more control):
node src/compositor.mjs output/tab.mov --template dark-overlay --output final.mp4
node src/compositor.mjs output/tab.mov --template my_template.json --output final.mp4
```

### Built-in Templates

| Template | Resolution | Description |
|----------|-----------|-------------|
| `cinematic` | 1920x1080 | Dark background + vignette |
| `cinematic-title` | 1920x1080 | Dark bg + song title/artist text |
| `dark-overlay` | 1920x1080 | Video bg with cinematic grading + dark tab band |
| `reel` | 1080x1920 | Portrait video bg for IG Reels / TikTok |
| `reel-title` | 1080x1920 | Portrait + song title/artist text |

### Custom JSON Templates

```json
{
  "width": 1920, "height": 1080,
  "background": { "type": "video", "source": "bg.mp4" },
  "text": [
    { "content": "Song Title", "x": "center", "y": 60, "fontSize": 64, "color": "white", "shadowColor": "black@0.8" },
    { "content": "Artist", "x": "center", "y": 140, "fontSize": 36, "color": "gray", "alpha": 0.7 }
  ],
  "tab": { "y": "bottom", "scale": 1.0, "padding": 40, "darkBand": true },
  "effects": { "darken": 0.35, "colorTint": { "blue": 0.15 }, "vignette": true }
}
```

**Background types:** `video` (loops to fill duration), `image`, `solid` (hex color)
**Tab positioning:** `top`, `center`, `bottom` (default), or pixel value
**Effects:** `darken` (0-1), `colorTint` (red/green/blue 0-1), `vignette` (boolean)
**Text:** unlimited layers, each with position, size, color, alpha, shadow

## Rendering Features

- **Tab-only rendering** -- standard notation hidden, tab staff only
- **5 track color palettes** -- white (lead), pink (rhythm), cyan (harmony), gold (bass), green
- **Multi-track stacking** -- multiple tracks rendered vertically with per-track colors and 4px gap
- **Beat-accurate cursor** -- configurable color (red, white, cyan, green, yellow, orange) and width
- **Cursor at 1/3 viewport** -- 2/3 look-ahead for readability
- **Watermark removal** -- alphaTab attribution stripped from pixel data
- **Notation scale** -- 1.0x default, 1.3-1.5x for larger tab numbers (useful for 4K)
- **Section markers** -- GP file sections (Intro, Verse, Chorus) rendered as labeled overlays
- **Tuning detection** -- identifies E Standard, Drop D, etc. from MIDI values (4-8 string)

## Audio Sync

Mux audio into the video output with `--audio`:

```bash
node src/index.mjs song.gp 0 --audio mix.wav --platform youtube
node src/index.mjs song.gp 0 --video playthrough.mp4 --audio mix.wav  # replaces footage audio
```

Assumes audio starts at bar 1 beat 1 at the GP file's BPM (standard DAW bounce workflow). Supports WAV, MP3, FLAC, M4A, and any format ffmpeg can read.

## Additional Tools

### Browser Preview

```bash
node src/preview.mjs song.gp                    # auto-opens browser
node src/preview.mjs song.gp --tracks 0,2 3000  # pre-select tracks, custom port
```

Live preview with alphaTab's MIDI player, cursor, and scrolling. Color-coded track toggle chips, horizontal/page layout modes, play/pause/stop, drag-and-drop file loading.

### Batch Rendering

```bash
node src/batch.mjs ~/compositions/*.gp --style playthrough
node src/batch.mjs ~/compositions/ --platform youtube,instagram --tracks 0
node src/batch.mjs song1.gp song2.gp5 --style clean --fps 60
```

Directories scanned for GP files automatically. Platform comma-separation produces one output per file per platform.

### Composite Reels

```bash
node src/composite-reel.mjs song.gp --start-bar 69 --duration 15 --platform instagram
```

Background rendering + tab overlay + alpha compositing + color grading + platform-spec encoding in one pass. Supports `--bg neon-guitar` (built-in Canvas 2D animation) or external video via ffmpeg.

## Video Encoding

- H.264 for .mp4 (standalone or composite)
- ProRes 4444 for .mov (transparent alpha channel)
- Platform-aware bitrate targeting (ABR mode when preset active, CRF 18 otherwise)
- AAC audio with platform-specific bitrate and sample rate

## Performance

| Scenario | Time |
|----------|------|
| 3 min song, 30fps, 1080p, single track | ~9s |
| 3 min song, 30fps, 1080p, multi-track (2 tracks) | ~25s |
| 3 min song, 60fps, 1080p | ~15s |

Frame generation runs at ~600 frames/sec. The bottleneck is ffmpeg encoding, not frame generation.

## Workflow

### YouTube (Horizontal)

1. Write/arrange in Guitar Pro
2. Record in DAW (session tempo = GP file BPM)
3. Film playthrough horizontally (4K 30fps, HDR OFF)
4. Transfer to Mac
5. `node src/index.mjs song.gp 0 --style playthrough --platform youtube --video playthrough.mp4`
6. Upload

### Instagram Reels / TikTok / YouTube Shorts (Portrait)

1. Film playthrough vertically
2. Render:
   ```bash
   # Template compositor (tab at bottom, title text above)
   node src/index.mjs song.gp 0 --style playthrough --template reel-title --title "Song" --artist "Artist"

   # Or platform preset with footage
   node src/index.mjs song.gp 0 --style playthrough --platform instagram --video playthrough.mp4
   ```
3. Upload -- tab positioned above platform safe zone automatically

### NLE Compositing (Premiere / Resolve)

1. `node src/index.mjs song.gp 0 --style playthrough --transparent`
2. Import .mov as layer over footage
3. Scale/position/grade to taste

### Camera Settings (iPhone 16 Pro Max)

- **Resolution:** 4K
- **Frame Rate:** 30fps (cinematic) or 60fps (fast playing)
- **HDR Video:** OFF (Rec.709 SDR avoids color mismatch with tab overlay)
- **Format:** HEVC (recommended) or Apple ProRes
- **Stabilization:** Standard (not Action Mode)

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
  v
generate-frames.mjs ----- raw pixel crop from strip + cursor alpha blend
  |                        + watermark removal + section marker labels
  |                        ~600 frames/sec throughput
  v
encode-video.mjs -------- ffmpeg stdin pipe (raw RGBA -> ProRes 4444 / H.264)
  |                        + optional audio muxing (--audio)
  |                        platform-aware bitrate, audio codec, sample rate
  v
index.mjs --------------- CLI orchestrator, arg parser, composite pipeline
  |                        multi-track stacking via sharp, tuning detection
  |
  +-- compositor.mjs ----- Template compositor (ffmpeg filter graphs)
  |                        5 built-in templates + custom JSON
  +-- batch.mjs ---------- Multi-file/multi-platform batch rendering
  +-- composite-reel.mjs - Background video/animation + tab overlay
  |                        + neon-guitar-bg.mjs (Canvas 2D animation)
  +-- preview.mjs -------- HTTP server + browser UI (alphaTab player)
  +-- probe-audio.mjs ---- ffprobe wrapper for audio validation
  +-- tuning.mjs --------- Tuning detection from MIDI note values
  v
.mov or .mp4
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
- [Instagram video specs](https://socialrails.com/blog/instagram-video-size-format-specifications-guide)
- [Instagram safe zones](https://zeely.ai/blog/master-instagram-safe-zones/)
- [Instagram carousel sizes](https://www.overvisual.com/tools/instagram-carousel-size)
- [Facebook video specs](https://www.aiarty.com/knowledge-base/facebook-video-size.htm)
- [Facebook Reels specs](https://www.aiarty.com/knowledge-base/facebook-reel-size.htm)
- [Facebook Reels safe zones](https://sendshort.ai/guides/facebook-reels-size/)
- [TikTok video specs](https://fliki.ai/blog/tiktok-video-size)
- [TikTok safe zones](https://kreatli.com/guides/tiktok-safe-zone)
