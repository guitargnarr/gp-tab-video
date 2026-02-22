# Guitar Playthrough Video Workflow

Complete start-to-finish guide for recording a guitar playthrough and producing a tab overlay video ready for upload.

## Overview

```
GP File ──> prep.mjs ──> Click Track WAV
                              |
                    [ Play in earbuds ]
                              |
                     iPhone ──> Video footage
                     Logic Pro ──> DI audio (optional)
                              |
GP File + footage + audio ──> index.mjs ──> Final video
                                                |
                                           [ Upload ]
```

---

## Phase 1: Prep (5 min)

### 1.1 Generate click track

```bash
cd ~/Projects/gp-tab-video

# Standard (quarter note clicks)
node src/prep.mjs path/to/song.gp --count-in 2

# Slow tempo (< 80 BPM) -- use eighth note subdivision
node src/prep.mjs path/to/song.gp --count-in 2 --subdivide 2

# Fast tempo with triplet feel
node src/prep.mjs path/to/song.gp --count-in 2 --subdivide 3
```

**Output:** `output/<song>_click.wav` + tempo summary + Logic Pro instructions

### 1.2 Read the output

prep.mjs prints everything you need:
- BPM and time signature
- Tempo changes with bar numbers
- Section markers (Intro, Verse, Chorus)
- Logic Pro setup steps (exact tempo automation values)

### 1.3 Choose your workflow

| Workflow | Audio Source | Best For | Time |
|----------|-------------|----------|------|
| **Quick** | iPhone mic | Reels, TikTok, Shorts | 15 min |
| **Polished** | Logic Pro DI bounce | YouTube, portfolio | 30 min |

---

## Phase 2a: Quick Recording (iPhone Only)

### 2a.1 iPhone camera settings

Open Settings > Camera:

| Setting | Value | Why |
|---------|-------|-----|
| **Format** | High Efficiency (HEVC) | Smaller files, same quality |
| **Resolution** | 4K | Downscales cleanly to 1080p |
| **Frame Rate** | 30 fps | Matches all platform presets |
| **HDR Video** | **OFF** | Rec.709 SDR avoids color mismatch with tab overlay |
| **Stabilization** | Standard | Action Mode crops too aggressively |
| **Grid** | On | Helps frame guitar position |

### 2a.2 Orientation by platform

| Platform | Orientation | Aspect |
|----------|-------------|--------|
| YouTube | **Landscape** (horizontal) | 16:9 |
| Instagram Reels | **Portrait** (vertical) | 9:16 |
| Instagram Feed | **Portrait** (vertical) | 4:5 |
| TikTok | **Portrait** (vertical) | 9:16 |
| YouTube Shorts | **Portrait** (vertical) | 9:16 |
| Facebook Reels | **Portrait** (vertical) | 9:16 |

### 2a.3 Record

1. Transfer click WAV to iPhone (AirDrop) or play from Mac speakers/monitors
2. Put one earbud in (click track), leave one out (hear your guitar)
3. Open Camera app, set to Video mode
4. Hit record
5. Listen for the count-in clicks (2 bars), then start playing on bar 1
6. Play through the song
7. Stop recording

### 2a.4 Transfer footage

AirDrop the video to your Mac, or import via Image Capture / Photos.

---

## Phase 2b: Polished Recording (Logic Pro + iPhone)

### 2b.1 Logic Pro session setup

1. **New session** -- set project tempo to the BPM prep.mjs reported
2. **If tempo changes exist:** add tempo automation at the exact bar numbers prep.mjs listed
3. **Time signature:** match the GP file (4/4, 3/4, 6/8, etc.)
4. **Sample rate:** 48000 Hz (matches prep.mjs default and all platform presets)

### 2b.2 Click track verification

1. Import the click WAV onto a track
2. Play it -- verify clicks align with Logic's grid/metronome
3. Once confirmed, you can use either Logic's built-in click or the WAV
4. Route click to headphones only (not to the main mix)

### 2b.3 Recording setup

| Track | Input | Purpose |
|-------|-------|---------|
| DI Guitar | Audio interface input | Clean signal for mixing |
| Click | WAV import or Logic click | Tempo reference (headphones only) |
| Amp sim (optional) | DI track bus | Real-time monitoring tone |

### 2b.4 Record

1. Arm the DI track
2. Route click to headphones
3. Set up iPhone simultaneously (same framing as Phase 2a)
4. Start Logic recording and iPhone recording at roughly the same time
5. The count-in syncs everything -- both recordings start from the same tempo reference
6. Play through the song
7. Stop both recordings

### 2b.5 Bounce audio

1. Mix the DI track (EQ, compression, amp sim, reverb -- whatever you want)
2. **File > Bounce > Project or Section**
3. Settings:
   - Format: WAV
   - Resolution: 24-bit
   - Sample Rate: 48000 Hz
   - Start: Bar 1 Beat 1 (not the count-in)
   - End: End of song
4. Save as `mix.wav`

### 2b.6 Transfer footage

AirDrop the iPhone video to your Mac.

---

## Phase 3: Generate Video (1-2 min)

### 3.1 Quick workflow (iPhone audio)

```bash
# YouTube (landscape)
node src/index.mjs song.gp 0 \
  --style playthrough \
  --platform youtube \
  --video playthrough.mp4 \
  --template cinematic-title \
  --watermark assets/charioteer.png \
  --intro \
  --title "Song Name" \
  --artist "@guitargnar"

# Instagram Reel (portrait)
node src/index.mjs song.gp 0 \
  --style playthrough \
  --platform instagram \
  --video playthrough.mp4 \
  --template reel-title \
  --watermark assets/charioteer.png \
  --intro \
  --title "Song Name" \
  --artist "@guitargnar"
```

### 3.2 Polished workflow (Logic Pro audio replaces iPhone mic)

```bash
# YouTube (landscape) with DAW mix
node src/index.mjs song.gp 0 \
  --style playthrough \
  --platform youtube \
  --video playthrough.mp4 \
  --audio mix.wav \
  --template cinematic-title \
  --watermark assets/charioteer.png \
  --intro \
  --title "Song Name" \
  --artist "@guitargnar"

# Instagram Reel (portrait) with DAW mix
node src/index.mjs song.gp 0 \
  --style playthrough \
  --platform instagram \
  --video playthrough.mp4 \
  --audio mix.wav \
  --template reel-title \
  --watermark assets/charioteer.png \
  --intro \
  --title "Song Name" \
  --artist "@guitargnar"
```

### 3.3 Multi-platform batch (one recording, all platforms)

```bash
# Generate for every platform from the same footage
for platform in youtube instagram tiktok youtube-shorts facebook; do
  node src/index.mjs song.gp 0 \
    --style playthrough \
    --platform $platform \
    --video playthrough.mp4 \
    --audio mix.wav \
    --template cinematic-title \
    --watermark assets/charioteer.png \
    --intro \
    --title "Song Name" \
    --artist "@guitargnar"
done
```

---

## Phase 4: Upload

### Platform specs (handled automatically by --platform)

| Platform | Flag | Resolution | Aspect | Bitrate | Audio | Max Duration |
|----------|------|-----------|--------|---------|-------|-------------|
| YouTube | `youtube` | 1920x1080 | 16:9 | 12 Mbps | AAC 384k | Unlimited |
| YouTube 4K | `youtube-4k` | 3840x2160 | 16:9 | 45 Mbps | AAC 384k | Unlimited |
| YouTube Shorts | `youtube-shorts` | 1080x1920 | 9:16 | 8 Mbps | AAC 256k | 3 min |
| Instagram Reels | `instagram` | 1080x1920 | 9:16 | 6 Mbps | AAC 256k | 15 min |
| Instagram Story | `instagram-story` | 1080x1920 | 9:16 | 4 Mbps | AAC 256k | 60s segments |
| Instagram Feed | `instagram-feed` | 1080x1350 | 4:5 | 5 Mbps | AAC 256k | 90s |
| Instagram Carousel | `instagram-carousel` | 1080x1350 | 4:5 | 5 Mbps | AAC 256k | 60s/slide |
| Facebook Reels | `facebook` | 1080x1920 | 9:16 | 8 Mbps | AAC 192k | No cap |
| Facebook Story | `facebook-story` | 1080x1920 | 9:16 | 6 Mbps | AAC 192k | 20s cards |
| TikTok | `tiktok` | 1080x1920 | 9:16 | 8 Mbps | AAC 256k | 10 min |

### Safe zones (tab placement handled automatically)

| Platform | Top | Bottom | Notes |
|----------|-----|--------|-------|
| YouTube | -- | -- | No overlay UI on landscape |
| YouTube Shorts | -- | 200px | Subscribe button |
| Instagram Reels | 108px | 320px | Profile bar, captions/buttons |
| Instagram Story | 250px | 250px | Reply bar, stickers |
| Facebook Reels | 269px | **672px** | Like/comment/share, description |
| TikTok | 108px | 320px | Username, captions, CTA |

Facebook's bottom safe zone is 35% of the screen -- the tab is placed significantly higher than on other platforms.

### Upload checklist

- [ ] Watch the video end-to-end before uploading
- [ ] Verify tab scroll is synced to your playing
- [ ] Check audio levels (not clipping, not too quiet)
- [ ] Confirm correct aspect ratio for the platform
- [ ] Add title, description, hashtags
- [ ] Set thumbnail (first frame of intro sequence works well)

### Recommended hashtags by platform

**YouTube:** Title, artist, technique in description. Tags: guitar, tab, playthrough, tutorial

**Instagram:** #guitartok #guitartab #guitarlesson #guitarpractice #playthrough #guitargnar

**TikTok:** #guitartok #guitar #tab #playthrough #guitargnar #learnguitar

**YouTube Shorts:** Same as YouTube, shorter description

---

## Quick Reference

### Entire workflow in 4 commands

```bash
# 1. Click track
node src/prep.mjs song.gp --count-in 2 --subdivide 2

# 2. Record (film with click in earbuds)

# 3. Generate video
node src/index.mjs song.gp 0 --style playthrough --platform youtube \
  --video playthrough.mp4 --template cinematic-title \
  --watermark assets/charioteer.png --intro \
  --title "Song" --artist "@guitargnar"

# 4. Upload
```

### Decision tree

```
Is the tempo < 80 BPM?
  Yes --> --subdivide 2 (eighth note clicks)
  No  --> default (quarter note clicks)

Do you need polished audio?
  Yes --> Logic Pro DI recording + --audio mix.wav
  No  --> iPhone mic is fine (skip Logic Pro entirely)

What platform?
  YouTube long-form  --> --platform youtube (landscape filming)
  Instagram Reel     --> --platform instagram (portrait filming)
  TikTok             --> --platform tiktok (portrait filming)
  YouTube Short      --> --platform youtube-shorts (portrait filming)
  Facebook Reel      --> --platform facebook (portrait filming)
  Instagram Feed     --> --platform instagram-feed (portrait filming)
  Multiple           --> run the for loop from Phase 3.3
```
