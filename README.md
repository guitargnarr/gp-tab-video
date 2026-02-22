# gp-tab-video

Guitar practice, video production, and visualization -- three tools built on the same GP file parsing core.

### Practice
Generate exercises or load any GP file into a browser-based practice engine with difficulty analysis, spaced repetition, and MIDI playback.

```bash
node src/practice.mjs serve                          # open browser, generate exercises on demand
node src/practice.mjs song.gp serve                  # practice an existing file
```

### Tab Video
GP file in, playthrough-ready video out -- no manual video editing required.

```bash
node src/index.mjs song.gp 0 --style playthrough --platform youtube --video playthrough.mp4
```

### Visualizer
Audio file in, animated social media content out -- audio-reactive backgrounds synced to song dynamics.

```bash
node src/visualizer.mjs audio.wav --style ocean --platform instagram-story
```

---

## Practice Engine

Browser-based adaptive practice with exercise generation, difficulty analysis, and mastery tracking.

### Quick Start

```bash
# No file -- generate exercises from the browser
node src/practice.mjs serve

# Load an existing GP file for practice
node src/practice.mjs song.gp serve
```

Opens `http://localhost:3001` with four tabs:

- **Session** -- 4-phase practice plan (isolation, context, interleaving, run-through) with tempo tiers
- **Chunks** -- bar groupings by difficulty with technique labels
- **Progress** -- mastery levels and spaced repetition schedule per chunk
- **Generate** -- create exercises by root, scale, pattern, bars, tempo, and tuning

### Exercise Generation

The Generate tab connects to [guitar-model-lab](https://github.com/guitargnarr/guitar-model-lab), a FastAPI service that produces GP5 files from scale/pattern parameters. The practice server proxies all API calls -- the browser never talks to the remote API directly.

Available parameters:
- **Root:** C through B (12 notes)
- **Scale:** pentatonic minor, blues, major, natural minor, harmonic minor, phrygian, dorian, mixolydian, lydian, locrian, whole tone, diminished, chromatic
- **Pattern:** ascending, descending, alternate, groups of 3, groups of 4, sweep, string skipping, intervallic, sequence, arpeggio
- **Bars:** 1-16
- **Tempo:** 40-240 BPM
- **Tuning:** standard, drop D, drop C, half step down, open G, open D, DADGAD

Generated GP5 files are saved to `output/` for later video rendering.

### Difficulty Analysis

Each bar is scored on:
- Note density (notes per beat)
- String crossings (adjacent vs skip)
- Fret span within a beat
- Position shifts between beats
- Technique complexity (bends, harmonics, tapping, sweeps)

Bars are grouped into practice chunks by pattern similarity. Chunks get a composite difficulty score that drives tempo assignment.

### Mastery Tracking

Chunks progress through mastery levels via ratings (1-5 after each practice rep):

| Level | Tempo | Review Interval |
|-------|-------|-----------------|
| New | 40% | immediate |
| Learning | 55% | 1 day |
| Developing | 70% | 3 days |
| Proficient | 85% | 7 days |
| Solid | 100% | 14 days |
| Mastered | 100% | 30 days |

Rating 4-5 promotes a chunk. Rating 1-2 demotes it. State persists in `output/` as JSON keyed by file hash.

### CLI Commands

```bash
node src/practice.mjs song.gp                          # analyze difficulty per bar
node src/practice.mjs song.gp session                   # generate today's practice session
node src/practice.mjs song.gp progress                  # show mastery across all chunks
node src/practice.mjs song.gp rate chunk-0:5 chunk-1:3  # rate chunks after practicing
node src/practice.mjs song.gp click chunk-2             # click track for one chunk
node src/practice.mjs song.gp reset                     # clear practice state
```

### Practice Session Phases

| Phase | Purpose | Tempo | Method |
|-------|---------|-------|--------|
| Isolation | Learn each chunk separately | 40-100% based on mastery | 2-5 reps per chunk, slowest first |
| Context | Play chunks in order | 70% of base | Sequential, building continuity |
| Interleaving | Random order | 70% of base | Forces recall under uncertainty |
| Run-through | Full piece start to finish | 60% of base | Note problem spots for next session |

---

## Tab Video

GP file in, platform-ready playthrough video out.

1. Parses any GP format (GP3, GP4, GP5, GP6, GP7, GPX)
2. Renders a horizontal tab strip with beat-accurate pixel positions
3. Generates scrolling frames with a glowing cursor synced to tempo
4. Composites onto playthrough footage or a designed template
5. Outputs a platform-optimized video ready for upload

### Quick Start

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

Compositing:
  --video FILE      Playthrough footage to composite tab overlay onto
  --template T      Template compositor (JSON file or built-in name)
  --title TEXT      Song title for template text layers
  --artist TEXT     Artist name for template text layers
  --watermark FILE  Watermark image (PNG with transparency)
  --intro           Add logo intro sequence (requires --watermark)

Audio:
  --audio FILE      Audio file (WAV/MP3/FLAC) to mux into the output
                    With --video: replaces footage audio with this file

Platform:
  --platform NAME   Platform preset (sets resolution, bitrate, safe zones)
  --vertical        Force 9:16 vertical output
```

CLI flags override preset values: `--platform instagram --fps 60` uses IG defaults but at 60fps.

### Output Modes

| Mode | Command | Output |
|------|---------|--------|
| Standalone | `node src/index.mjs song.gp` | .mp4 -- tab on dark background |
| Transparent overlay | `--transparent` | .mov ProRes 4444 with alpha |
| Footage composite | `--video playthrough.mp4` | .mp4 -- tab over iPhone footage |
| Template composite | `--template cinematic-title` | .mp4 -- tab + background + text + effects |
| Branded composite | `--template ... --watermark logo.png --intro` | .mp4 -- intro sequence + watermark overlay |
| Portrait reel | `--template reel` | .mp4 -- 1080x1920 for IG/TikTok |

### Style Presets

| Style | What Shows | What's Hidden |
|-------|-----------|---------------|
| `default` | Everything | Nothing |
| `clean` | All techniques + bar numbers | Title, tuning, track names, tempo, triplet feel |
| `playthrough` | P.M., H/P, bends, harmonics, vibrato, dynamics, bar numbers | Metadata, fingering, capo, lyrics, pedals |
| `minimal` | Tab numbers and staff lines only | All annotations |

#### Notation Toggles

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

### Platform Presets

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

### Template Compositor

Composite the tab overlay onto a designed template with background, text, and effects -- pure ffmpeg, no external software:

```bash
# Via index.mjs (one command):
node src/index.mjs song.gp 0 --style playthrough --template cinematic-title --title "My Song" --artist "Artist"

# Via compositor.mjs (standalone, more control):
node src/compositor.mjs output/tab.mov --template dark-overlay --output final.mp4
node src/compositor.mjs output/tab.mov --template my_template.json --output final.mp4
```

#### Built-in Templates

| Template | Resolution | Description |
|----------|-----------|-------------|
| `cinematic` | 1920x1080 | Dark background + vignette |
| `cinematic-title` | 1920x1080 | Dark bg + song title/artist text |
| `dark-overlay` | 1920x1080 | Video bg with cinematic grading + dark tab band |
| `reel` | 1080x1920 | Portrait video bg for IG Reels / TikTok |
| `reel-title` | 1080x1920 | Portrait + song title/artist text |

#### Custom JSON Templates

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

#### Watermark + Intro

```bash
# Watermark only (persistent corner logo)
node src/compositor.mjs output/tab.mov --watermark assets/charioteer.png

# Intro + watermark
node src/compositor.mjs output/tab.mov --template cinematic-title --watermark assets/charioteer.png --intro --title "Song" --artist "Artist"

# One-command from GP file
node src/index.mjs song.gp 0 --style playthrough --template cinematic-title --watermark assets/charioteer.png --intro
```

Watermark defaults: bottom-right, 12% of output width, 30% opacity, 20px margin. Override via template JSON:

```json
{
  "watermark": { "position": "top-right", "scale": 0.15, "opacity": 0.4, "margin": 30 },
  "intro": { "duration": 3, "fadeIn": 1, "hold": 1, "fadeOut": 1, "scale": 0.4, "background": "0x000000" }
}
```

Positions: `top-left`, `top-right`, `bottom-left`, `bottom-right`

### Rendering Features

- **Tab-only rendering** -- standard notation hidden, tab staff only
- **5 track color palettes** -- white (lead), pink (rhythm), cyan (harmony), gold (bass), green
- **Multi-track stacking** -- multiple tracks rendered vertically with per-track colors and 4px gap
- **Beat-accurate cursor** -- configurable color (red, white, cyan, green, yellow, orange) and width
- **Cursor at 1/3 viewport** -- 2/3 look-ahead for readability
- **Watermark removal** -- alphaTab attribution stripped from pixel data
- **Notation scale** -- 1.0x default, 1.3-1.5x for larger tab numbers (useful for 4K)
- **Section markers** -- GP file sections (Intro, Verse, Chorus) rendered as labeled overlays
- **Tuning detection** -- identifies E Standard, Drop D, etc. from MIDI values (4-8 string)

### Audio Sync

```bash
node src/index.mjs song.gp 0 --audio mix.wav --platform youtube
node src/index.mjs song.gp 0 --video playthrough.mp4 --audio mix.wav  # replaces footage audio
```

Assumes audio starts at bar 1 beat 1 at the GP file's BPM (standard DAW bounce workflow). Supports WAV, MP3, FLAC, M4A, and any format ffmpeg can read.

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

---

## Visualizer

Audio-reactive animated backgrounds for social media content. No tab notation, no text overlays -- just audio-driven visuals optimized for platform specs.

```bash
node src/visualizer.mjs audio.wav --style ocean --platform instagram-story
node src/visualizer.mjs audio.wav --style particles --platform tiktok
node src/visualizer.mjs audio.wav --style fluid --platform youtube-shorts
```

### How It Works

1. Analyzes audio dynamics (per-frame RMS energy extraction)
2. Maps energy to visual parameters (wave height, particle density, color intensity)
3. Renders frames via Canvas 2D / WebGL driven by the audio energy map
4. Encodes platform-optimized video with the original audio muxed in

### Visual Styles

| Style | Description | Audio Mapping |
|-------|-------------|---------------|
| `ocean` | Dark ocean surface with procedural waves | Energy controls wave height, foam, light refraction |
| `particles` | Floating particle field in 3D space | Energy controls speed, density, clustering |
| `fluid` | Ink-in-water / smoke simulation | Energy controls turbulence and bloom intensity |
| `radial` | Concentric rings pulsing outward | Frequency bands map to ring radius and opacity |
| `terrain` | Abstract wireframe landscape | Amplitude sculpts terrain height in real-time |

Quiet sections produce slow, minimal visuals. Loud sections produce explosive, dense visuals. Silence fades to near-black. All transitions are smooth and driven by the actual audio waveform.

Same `--platform` flags as tab mode. Resolution, bitrate, and aspect ratio are handled automatically.

---

## Additional Tools

### Recording Prep (Click Track Generator)

```bash
node src/prep.mjs song.gp                      # click track at 48kHz
node src/prep.mjs song.gp --count-in 2          # 2 bars of count-in
node src/prep.mjs song.gp --subdivide 2         # eighth note clicks (2x feel)
node src/prep.mjs song.gp --subdivide 3         # triplet clicks
node src/prep.mjs song.gp --sample-rate 44100   # 44.1kHz for Logic Pro
node src/prep.mjs song.gp --no-accent           # equal volume all beats
```

Reads the GP file's tempo map (including mid-song tempo changes and time signature changes) and generates a click track WAV. Three distinct click sounds: high (downbeat), medium (other beats), soft (subdivisions). Output includes a tempo summary and Logic Pro setup instructions.

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

Background rendering + tab overlay + alpha compositing + color grading + platform-spec encoding in one pass.

---

## Workflows

### Learn a Song

1. `node src/practice.mjs song.gp serve`
2. Browser opens -- Session tab shows today's practice plan
3. Click a chunk to highlight bars, hit Play to hear it
4. Rate each chunk after practicing (1-5)
5. Mastery advances, tempo increases, review intervals grow
6. Tomorrow: chunks due for review appear automatically

### Generate and Practice Exercises

1. `node src/practice.mjs serve` (no file)
2. Browser opens to Generate tab
3. Pick root, scale, pattern, bars, tempo, tuning
4. Click "Generate & Load" -- tab renders, session populates
5. Practice with the same chunk/rating/mastery flow
6. GP5 saved to `output/` -- use it for video later

### Record a YouTube Playthrough

1. Write/arrange in Guitar Pro
2. `node src/prep.mjs song.gp --count-in 2` -- click track + Logic Pro tempo instructions
3. Record in DAW using click track for tempo sync
4. Film playthrough horizontally (4K 30fps, HDR OFF) with click in earbuds
5. `node src/index.mjs song.gp 0 --style playthrough --platform youtube --video playthrough.mp4`
6. Upload

### Instagram Reels / TikTok / YouTube Shorts

1. `node src/prep.mjs song.gp --count-in 2`
2. Film playthrough vertically with click in earbuds
3. `node src/index.mjs song.gp 0 --style playthrough --template reel-title --title "Song" --artist "Artist"`
4. Upload -- tab positioned above platform safe zone automatically

### NLE Compositing (Premiere / Resolve)

1. `node src/index.mjs song.gp 0 --style playthrough --transparent`
2. Import .mov as layer over footage
3. Scale/position/grade to taste

### Full Pipeline: Practice to Publish

1. `node src/practice.mjs serve` -- generate an exercise, practice until mastered
2. `node src/prep.mjs output/E_pentatonic_minor_ascending.gp5 --count-in 2` -- click track
3. Film playthrough with click in earbuds
4. `node src/index.mjs output/E_pentatonic_minor_ascending.gp5 0 --style playthrough --platform youtube --video playthrough.mp4`
5. Upload

### Camera Settings (iPhone 16 Pro Max)

- **Resolution:** 4K
- **Frame Rate:** 30fps (cinematic) or 60fps (fast playing)
- **HDR Video:** OFF (Rec.709 SDR avoids color mismatch with tab overlay)
- **Format:** HEVC (recommended) or Apple ProRes
- **Stabilization:** Standard (not Action Mode)

---

## Architecture

```
GP file (.gp/.gp5/.gpx)
  |
  v
load-score.mjs ----------- alphaTab ScoreLoader, auto-detects format
  |                          + loadScoreFromBuffer for in-memory GP5
  |
  +---> render-strip.mjs --- ScoreRenderer + alphaSkia -> horizontal PNG strip
  |       |                    + style presets, notation toggles, color palettes
  |       |                    + BoundsLookup (beat pixel positions)
  |       v
  |     build-timing.mjs --- MIDI ticks -> ms (handles tempo changes)
  |       |                    + section marker extraction with pixel positions
  |       v
  |     generate-frames.mjs  raw pixel crop from strip + cursor alpha blend
  |       |                    + watermark removal + section marker labels
  |       |                    ~600 frames/sec throughput
  |       v
  |     encode-video.mjs --- ffmpeg stdin pipe (raw RGBA -> ProRes 4444 / H.264)
  |       |                    + optional audio muxing (--audio)
  |       |                    platform-aware bitrate, audio codec, sample rate
  |       v
  |     index.mjs ---------- CLI orchestrator, arg parser, composite pipeline
  |       |                    multi-track stacking via sharp, tuning detection
  |       |
  |       +-- compositor.mjs ----- Template compositor (ffmpeg filter graphs)
  |       +-- batch.mjs ---------- Multi-file/multi-platform batch rendering
  |       +-- composite-reel.mjs - Background video/animation + tab overlay
  |       +-- preview.mjs -------- HTTP server + browser UI (alphaTab player)
  |       +-- prep.mjs ----------- Click track WAV from GP tempo map
  |       v
  |     .mov or .mp4
  |
  +---> practice.mjs -------- Adaptive practice engine
          |                     difficulty analysis, spaced rep, mastery tracking
          |                     HTTP server proxying guitar-model-lab API
          |
          +-- practice/index.html  Browser UI
          |     alphaTab renderer, Session/Chunks/Progress/Generate tabs
          |     exercise generation via guitar-model-lab proxy
          |
          +-- guitar-model-lab --- Remote API (guitar-model-lab.onrender.com)
                                    POST /generate-gp5 -> binary GP5
                                    GET /scales, /patterns, /tunings

Audio file (WAV/MP3/FLAC)
  |
  v
visualizer.mjs -------------- CLI orchestrator for audio-reactive video
  |
  +-- analyze-audio.mjs ----- Per-frame RMS energy extraction via ffmpeg
  +-- render-visuals.mjs ---- Canvas 2D / WebGL frame generation
  |                             driven by energy map (ocean, particles, fluid, etc.)
  +-- encode-video.mjs ------ Reuses same encoder (platform-aware bitrate/codec)
  v
.mp4 (platform-optimized)
```

## Requirements

- Node.js 22+ (tested on 25.2.1)
- ffmpeg 7+ (tested on 8.0)
- macOS (alphaSkia native binary is platform-specific)

## Dependencies

- `@coderline/alphatab` -- GP file parsing + notation rendering + MIDI playback
- `@coderline/alphaskia` + `alphaskia-macos` -- Skia-based PNG rendering (video mode)
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
