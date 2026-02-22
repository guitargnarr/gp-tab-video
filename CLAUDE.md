# gp-tab-video

## What This Is
Guitar practice engine, tab video renderer, and audio visualizer built on alphaTab GP file parsing. The practice engine is the primary active feature -- it connects to guitar-model-lab for exercise generation.

## Architecture

### Practice Engine (primary)
- `src/practice.mjs` -- CLI entry point, HTTP server, I/O, state persistence. Imports pure logic from practice-engine.mjs.
- `src/practice-engine.mjs` -- All pure functions extracted for testability. Difficulty scoring, session building, chunk grouping, click generation. **Never add I/O or side effects here.**
- `practice/index.html` -- Single-file browser UI with alphaTab renderer, 4 tabs (Session, Chunks, Progress, Generate).
- The practice server proxies `/api/*` to `guitar-model-lab.onrender.com` -- the browser never talks to the remote API directly.

### Tab Video Pipeline
`load-score.mjs` -> `render-strip.mjs` -> `build-timing.mjs` -> `generate-frames.mjs` -> `encode-video.mjs` -> `index.mjs` (orchestrator)

### Test Structure
- `tests/practice-engine.test.mjs` -- 69 tests covering all pure functions via vitest
- Run: `npm test`
- Mock helpers: `mockNote()`, `mockBeat()`, `mockVoice()`, `mockBar()`, `mockMasterBar()`, `mockScore()` -- use these, don't reinvent

## Known Pitfalls

### GP5 Rendering
- **BeatStatus.normal is REQUIRED** -- alphaTab silently renders rests instead of notes without it. Every beat in generated GP5 must have `beat.status = BeatStatus.normal`.
- GP5 files from guitar-model-lab are loaded via `loadScoreFromBuffer` (in-memory), not from disk.

### alphaTab playbackSpeed
- Accepts any positive float, not just 0-1. The UI slider goes to 3.0 (300%). Don't cap it at 1.0.
- Set via `alphaTabApi.playbackSpeed = value` where value is a decimal (1.0 = 100%).

### Exercise Generation (Generate Tab)
- **Position matters** -- position 1 = open/low frets (E shape). Most practice happens at positions 2-5. Default is position 3 (C shape, mid-fretboard).
- The Generate form sends params as JSON to `/api/generate`, which proxies to guitar-model-lab's `/generate-gp5` endpoint. Adding a new param to the form automatically flows through without server changes.
- Available patterns come from `/api/patterns` (proxied from guitar-model-lab). Don't hardcode pattern lists in the frontend.
- CAGED positions: 1=E shape (open), 2=D shape, 3=C shape, 4=A shape, 5=G shape.

### Module Extraction Pattern
- Pure logic lives in `practice-engine.mjs` (exported). I/O lives in `practice.mjs` (not exported).
- When adding new logic: if it's pure (no fs, no network, no process), put it in practice-engine.mjs and add tests.
- When adding I/O: keep it in practice.mjs, import pure helpers from practice-engine.mjs.
- **Never duplicate functions across both files.** practice.mjs imports from practice-engine.mjs.

### UI (practice/index.html)
- Single HTML file with inline CSS and JS. No build step, no bundler.
- alphaTab is loaded from CDN (`unpkg.com/@coderline/alphatab`).
- Speed slider: `max="300"`, value divided by 100 for playbackSpeed. Display shows `%`.
- The `generateAndLoad()` function collects all form values into a params object and POSTs to `/api/generate`.

## Commands
```
npm test                                    # vitest (69 tests)
node src/practice.mjs serve                 # practice server, no file
node src/practice.mjs song.gp serve         # practice server with file
node src/index.mjs song.gp                  # tab video
node src/preview.mjs song.gp               # browser preview
node src/prep.mjs song.gp                  # click track
```

## Dependencies
- `@coderline/alphatab` -- GP parsing, notation, MIDI playback
- `@coderline/alphaskia` + `alphaskia-macos` -- Skia PNG rendering (video mode)
- `sharp` -- image compositing
- `@napi-rs/canvas` -- Canvas 2D for visualizer
- `vitest` (dev) -- test runner
- ffmpeg (system) -- video encoding

## Companion Project
guitar-model-lab (FastAPI, Python) generates GP5 files from scale/pattern params.
Deployed at `guitar-model-lab.onrender.com` (Render free tier, ~30s cold start).
Repo: https://github.com/guitargnarr/guitar-model-lab
