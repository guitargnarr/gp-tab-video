#!/usr/bin/env node
/**
 * visualizer.mjs -- Audio-reactive video generator
 *
 * Audio file in, animated social media content out.
 * No tab notation, no text overlays -- just audio-driven visuals.
 *
 * Usage:
 *   node src/visualizer.mjs <audio-file> [options]
 *
 * Options:
 *   --style NAME      Visual style: ocean, particles, fluid, radial, terrain (default: ocean)
 *   --platform NAME   Platform preset (same as index.mjs: youtube, instagram, tiktok, etc.)
 *   --output FILE     Output path (default: output/<basename>_viz.mp4)
 *   --fps N           Frame rate (default: 30)
 *   --width N         Width override (default: from platform)
 *   --height N        Height override (default: from platform)
 */

import { analyzeAudio } from './analyze-audio.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { execFileSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// --- Platform presets (same as index.mjs) ---

const PLATFORMS = {
  'youtube':          { width: 1920, height: 1080, videoBitrate: '12M', audioBitrate: '384k', audioRate: 48000 },
  'youtube-4k':       { width: 3840, height: 2160, videoBitrate: '45M', audioBitrate: '384k', audioRate: 48000 },
  'youtube-shorts':   { width: 1080, height: 1920, videoBitrate: '8M',  audioBitrate: '256k', audioRate: 48000 },
  'instagram':        { width: 1080, height: 1920, videoBitrate: '6M',  audioBitrate: '256k', audioRate: 44100 },
  'instagram-story':  { width: 1080, height: 1920, videoBitrate: '4M',  audioBitrate: '256k', audioRate: 44100 },
  'instagram-feed':   { width: 1080, height: 1350, videoBitrate: '5M',  audioBitrate: '256k', audioRate: 44100 },
  'instagram-carousel': { width: 1080, height: 1350, videoBitrate: '5M', audioBitrate: '256k', audioRate: 44100 },
  'facebook':         { width: 1080, height: 1920, videoBitrate: '8M',  audioBitrate: '192k', audioRate: 44100 },
  'facebook-story':   { width: 1080, height: 1920, videoBitrate: '6M',  audioBitrate: '192k', audioRate: 44100 },
  'tiktok':           { width: 1080, height: 1920, videoBitrate: '8M',  audioBitrate: '256k', audioRate: 44100 },
};

// --- CLI ---

function parseArgs(argv) {
  const opts = {
    audioFile: null,
    style: 'nebula',
    platform: 'instagram-story',
    output: null,
    fps: 30,
    width: null,
    height: null,
  };

  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--style' && argv[i + 1]) {
      opts.style = argv[++i];
    } else if (a === '--platform' && argv[i + 1]) {
      opts.platform = argv[++i];
    } else if ((a === '--output' || a === '-o') && argv[i + 1]) {
      opts.output = argv[++i];
    } else if (a === '--fps' && argv[i + 1]) {
      opts.fps = parseInt(argv[++i], 10);
    } else if (a === '--width' && argv[i + 1]) {
      opts.width = parseInt(argv[++i], 10);
    } else if (a === '--height' && argv[i + 1]) {
      opts.height = parseInt(argv[++i], 10);
    } else if (a.startsWith('-')) {
      console.error(`Unknown option: ${a}`);
      process.exit(1);
    } else {
      positional.push(a);
    }
  }

  opts.audioFile = positional[0];
  return opts;
}

// --- Simplex noise (2D/3D) for organic deformation ---

function createNoise() {
  // Permutation table
  const perm = new Uint8Array(512);
  const p = [151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,140,36,103,30,
    69,142,8,99,37,240,21,10,23,190,6,148,247,120,234,75,0,26,197,62,94,252,219,
    203,117,35,11,32,57,177,33,88,237,149,56,87,174,20,125,136,171,168,68,175,74,
    165,71,134,139,48,27,166,77,146,158,231,83,111,229,122,60,211,133,230,220,105,
    92,41,55,46,245,40,244,102,143,54,65,25,63,161,1,216,80,73,209,76,132,187,208,
    89,18,169,200,196,135,130,116,188,159,86,164,100,109,198,173,186,3,64,52,217,
    226,250,124,123,5,202,38,147,118,126,255,82,85,212,207,206,59,227,47,16,58,17,
    182,189,28,42,223,183,170,213,119,248,152,2,44,154,163,70,221,153,101,155,167,
    43,172,9,129,22,39,253,19,98,108,110,79,113,224,232,178,185,112,104,218,246,97,
    228,251,34,242,193,238,210,144,12,191,179,162,241,81,51,145,235,249,14,239,107,
    49,192,214,31,181,199,106,157,184,84,204,176,115,121,50,45,127,4,150,254,138,
    236,205,93,222,114,67,29,24,72,243,141,128,195,78,66,215,61,156,180];
  for (let i = 0; i < 256; i++) { perm[i] = perm[i + 256] = p[i]; }

  const grad3 = [[1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],[1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],[0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]];

  function dot3(g, x, y, z) { return g[0]*x + g[1]*y + g[2]*z; }

  function noise3d(x, y, z) {
    const F3 = 1/3, G3 = 1/6;
    const s = (x+y+z)*F3;
    const i = Math.floor(x+s), j = Math.floor(y+s), k = Math.floor(z+s);
    const t = (i+j+k)*G3;
    const X0 = i-t, Y0 = j-t, Z0 = k-t;
    const x0 = x-X0, y0 = y-Y0, z0 = z-Z0;
    let i1,j1,k1,i2,j2,k2;
    if(x0>=y0){if(y0>=z0){i1=1;j1=0;k1=0;i2=1;j2=1;k2=0;}else if(x0>=z0){i1=1;j1=0;k1=0;i2=1;j2=0;k2=1;}else{i1=0;j1=0;k1=1;i2=1;j2=0;k2=1;}}
    else{if(y0<z0){i1=0;j1=0;k1=1;i2=0;j2=1;k2=1;}else if(x0<z0){i1=0;j1=1;k1=0;i2=0;j2=1;k2=1;}else{i1=0;j1=1;k1=0;i2=1;j2=1;k2=0;}}
    const x1=x0-i1+G3,y1=y0-j1+G3,z1=z0-k1+G3;
    const x2=x0-i2+2*G3,y2=y0-j2+2*G3,z2=z0-k2+2*G3;
    const x3=x0-1+3*G3,y3=y0-1+3*G3,z3=z0-1+3*G3;
    const ii=i&255,jj=j&255,kk=k&255;
    let n0=0,n1=0,n2=0,n3=0;
    let t0=0.6-x0*x0-y0*y0-z0*z0;if(t0>0){t0*=t0;n0=t0*t0*dot3(grad3[perm[ii+perm[jj+perm[kk]]]%12],x0,y0,z0);}
    let t1=0.6-x1*x1-y1*y1-z1*z1;if(t1>0){t1*=t1;n1=t1*t1*dot3(grad3[perm[ii+i1+perm[jj+j1+perm[kk+k1]]]%12],x1,y1,z1);}
    let t2=0.6-x2*x2-y2*y2-z2*z2;if(t2>0){t2*=t2;n2=t2*t2*dot3(grad3[perm[ii+i2+perm[jj+j2+perm[kk+k2]]]%12],x2,y2,z2);}
    let t3=0.6-x3*x3-y3*y3-z3*z3;if(t3>0){t3*=t3;n3=t3*t3*dot3(grad3[perm[ii+1+perm[jj+1+perm[kk+1]]]%12],x3,y3,z3);}
    return 32*(n0+n1+n2+n3);
  }

  return { noise3d };
}

// --- Nebula renderer (cinematic layered 3D formation) ---

function createNebulaRenderer(width, height) {
  const w = width;
  const h = height;
  const cx = w / 2;
  const cy = h / 2;
  const baseRadius = Math.min(w, h) * 0.22;
  const { noise3d } = createNoise();

  // --- Layer 1: Core particles (dense inner formation) ---
  const CORE_COUNT = 1500;
  const coreParticles = [];
  for (let i = 0; i < CORE_COUNT; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = 0.1 + Math.pow(Math.random(), 0.7) * 0.5;
    coreParticles.push({
      theta, phi, r,
      size: 0.6 + Math.random() * 2.2,
      brightness: 0.4 + Math.random() * 0.6,
      hueShift: (Math.random() - 0.5) * 25,
      noiseOffset: Math.random() * 100,
    });
  }

  // --- Layer 2: Outer dust ring (appears ~20% in, slowly fading up) ---
  const RING_COUNT = 600;
  const ringParticles = [];
  for (let i = 0; i < RING_COUNT; i++) {
    const angle = Math.random() * Math.PI * 2;
    const rDist = 0.65 + (Math.random() - 0.5) * 0.25;
    const yOff = (Math.random() - 0.5) * 0.12;
    ringParticles.push({
      angle, rDist, yOff,
      size: 0.4 + Math.random() * 1.4,
      brightness: 0.15 + Math.random() * 0.35,
      hueShift: 20 + Math.random() * 40, // warmer than core
      noiseOffset: Math.random() * 100,
    });
  }

  // --- Layer 3: Filament tendrils (organic curves, present from start) ---
  const NUM_FILAMENTS = 22;
  const FILAMENT_PTS = 70;
  const filaments = [];
  for (let f = 0; f < NUM_FILAMENTS; f++) {
    const baseTheta = (f / NUM_FILAMENTS) * Math.PI * 2 + Math.random() * 0.3;
    const basePhi = Math.PI * 0.25 + Math.random() * Math.PI * 0.5;
    const curl = 1.2 + Math.random() * 2.5;
    const rStart = 0.15 + Math.random() * 0.1;
    const rEnd = 0.55 + Math.random() * 0.5;
    const lineWidth = 0.6 + Math.random() * 1.8;
    const hue = (Math.random() - 0.5) * 50;
    filaments.push({ baseTheta, basePhi, curl, rStart, rEnd, lineWidth, hue });
  }

  // --- Layer 4: Accent nodes (pulsing hot spots in the core) ---
  const NUM_NODES = 10;
  const nodes = [];
  for (let i = 0; i < NUM_NODES; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = 0.15 + Math.random() * 0.35;
    nodes.push({
      theta, phi, r,
      pulseSpeed: 0.3 + Math.random() * 0.8,
      pulsePhase: Math.random() * Math.PI * 2,
      size: 12 + Math.random() * 30,
      hue: (Math.random() - 0.5) * 35,
    });
  }

  // --- Layer 5: Distant star field (appears ~40% in, very slow) ---
  const STAR_COUNT = 300;
  const stars = [];
  for (let i = 0; i < STAR_COUNT; i++) {
    stars.push({
      x: Math.random() * w,
      y: Math.random() * h,
      size: 0.3 + Math.random() * 1.2,
      brightness: 0.2 + Math.random() * 0.6,
      twinkleSpeed: 0.5 + Math.random() * 2,
      twinklePhase: Math.random() * Math.PI * 2,
    });
  }

  // --- Layer 6: Orbiting light streaks (appear ~60% in) ---
  const NUM_STREAKS = 5;
  const streaks = [];
  for (let i = 0; i < NUM_STREAKS; i++) {
    const orbitRadius = 0.4 + Math.random() * 0.35;
    const orbitSpeed = 0.2 + Math.random() * 0.3;
    const orbitPhase = (i / NUM_STREAKS) * Math.PI * 2;
    const orbitTilt = Math.PI * 0.3 + Math.random() * Math.PI * 0.4;
    const trailLen = 25 + Math.floor(Math.random() * 35);
    const hue = (Math.random() - 0.5) * 40;
    streaks.push({ orbitRadius, orbitSpeed, orbitPhase, orbitTilt, trailLen, hue });
  }

  // 3D helpers
  function rotateYXZ(x, y, z, ay, ax, az) {
    let x1 = x * Math.cos(az) - y * Math.sin(az);
    let y1 = x * Math.sin(az) + y * Math.cos(az);
    let x2 = x1 * Math.cos(ay) - z * Math.sin(ay);
    let z2 = x1 * Math.sin(ay) + z * Math.cos(ay);
    let y3 = y1 * Math.cos(ax) - z2 * Math.sin(ax);
    let z3 = y1 * Math.sin(ax) + z2 * Math.cos(ax);
    return [x2, y3, z3];
  }

  function proj(x, y, z) {
    const fov = 700;
    const s = fov / (fov + z);
    return [cx + x * s, cy + y * s, s, z];
  }

  return function renderFrame(ctx, frameIndex, e, time) {
    // e = { raw, slow, glacial, progress }
    // Use GLACIAL for all formation movement -- ultra smooth
    // Use SLOW for glow/warmth -- responsive but not twitchy
    // Use progress for layer reveals
    const eg = e.glacial;
    const es = e.slow;
    const progress = e.progress;

    // Organic breathing (pure time, no audio)
    const breathe = Math.sin(time * 0.35) * 0.03 + Math.sin(time * 0.13) * 0.02 + Math.sin(time * 0.07) * 0.01;

    // Formation parameters -- all driven by glacial (very smooth)
    const spread = 1.0 + eg * 0.15 + breathe;
    const morphSpeed = 0.05 + eg * 0.02;
    const morphAmount = 0.05 + eg * 0.08;

    // Aesthetic parameters -- driven by slow (responsive mood)
    const warmth = es * 0.5;
    const glowPower = 0.35 + es * 0.65;

    // Constant smooth rotation (NO audio influence on rotation speed)
    const coreAY = time * 0.13;
    const coreAX = Math.sin(time * 0.047) * 0.3;
    const coreAZ = time * 0.025;
    const ringAY = -time * 0.07;
    const ringAX = Math.sin(time * 0.031 + 1.5) * 0.2;
    const ringAZ = -time * 0.012;

    // Layer reveal timing (0-1, clamped)
    const ringReveal = Math.min(1, Math.max(0, (progress - 0.15) / 0.15));    // 15%-30%
    const starReveal = Math.min(1, Math.max(0, (progress - 0.35) / 0.15));    // 35%-50%
    const streakReveal = Math.min(1, Math.max(0, (progress - 0.55) / 0.15));  // 55%-70%

    const baseHue = 260;
    const warmHue = 325;

    // --- Background ---
    ctx.fillStyle = '#010008';
    ctx.fillRect(0, 0, w, h);

    // Volumetric atmosphere (3 offset glows, drifting slowly)
    for (let ai = 0; ai < 3; ai++) {
      const ax = cx + Math.sin(time * 0.04 + ai * 2.1) * baseRadius * 0.25;
      const ay = cy + Math.cos(time * 0.03 + ai * 1.7) * baseRadius * 0.2;
      const ar = baseRadius * (1.6 + ai * 0.4);
      const aHue = baseHue + ai * 15 + warmth * 30;
      const aAlpha = glowPower * (0.06 - ai * 0.015);
      const ag = ctx.createRadialGradient(ax, ay, 0, ax, ay, ar);
      ag.addColorStop(0, `hsla(${aHue}, 50%, 20%, ${aAlpha})`);
      ag.addColorStop(0.4, `hsla(${aHue + 10}, 40%, 12%, ${aAlpha * 0.4})`);
      ag.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
      ctx.fillStyle = ag;
      ctx.fillRect(0, 0, w, h);
    }

    // --- Stars (layer 5, fades in at ~35%) ---
    if (starReveal > 0) {
      for (const star of stars) {
        const twinkle = 0.5 + 0.5 * Math.sin(time * star.twinkleSpeed + star.twinklePhase);
        const alpha = star.brightness * twinkle * starReveal * 0.6;
        if (alpha < 0.02) continue;
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(200, 210, 240, ${alpha})`;
        ctx.fill();
      }
    }

    // --- Collect depth-sorted elements ---
    const drawList = [];

    // --- Filaments ---
    for (const fil of filaments) {
      const points = [];
      for (let i = 0; i < FILAMENT_PTS; i++) {
        const t = i / (FILAMENT_PTS - 1);
        const r = (fil.rStart + (fil.rEnd - fil.rStart) * t) * baseRadius * spread;
        const theta = fil.baseTheta + t * fil.curl + time * 0.05;
        const phi = fil.basePhi + Math.sin(t * Math.PI) * 0.4;

        const nx = noise3d(t * 1.5 + time * morphSpeed, fil.baseTheta, 0) * morphAmount * baseRadius;
        const ny = noise3d(t * 1.5, fil.baseTheta + time * morphSpeed, 10) * morphAmount * baseRadius;
        const nz = noise3d(t * 1.5, 20, fil.baseTheta + time * morphSpeed) * morphAmount * baseRadius;

        const px = r * Math.sin(phi) * Math.cos(theta) + nx;
        const py = r * Math.sin(phi) * Math.sin(theta) + ny;
        const pz = r * Math.cos(phi) + nz;

        const bAY = coreAY * 0.7 + ringAY * 0.3;
        const bAX = coreAX * 0.7 + ringAX * 0.3;
        const [rx, ry, rz] = rotateYXZ(px, py, pz, bAY, bAX, coreAZ * 0.3);
        const [sx, sy, sc, sz] = proj(rx, ry, rz);
        points.push({ sx, sy, sc, sz, t });
      }
      const avgZ = points.reduce((s, p) => s + p.sz, 0) / points.length;
      drawList.push({ type: 'fil', z: avgZ, points, lw: fil.lineWidth, hue: fil.hue });
    }

    // --- Core particles ---
    for (const p of coreParticles) {
      const nv = noise3d(p.theta + time * morphSpeed, p.phi + time * morphSpeed * 0.6, p.noiseOffset);
      const r = (p.r + nv * morphAmount) * baseRadius * spread;
      const px = r * Math.sin(p.phi) * Math.cos(p.theta);
      const py = r * Math.sin(p.phi) * Math.sin(p.theta);
      const pz = r * Math.cos(p.phi) * 0.65;
      const [rx, ry, rz] = rotateYXZ(px, py, pz, coreAY, coreAX, coreAZ);
      const [sx, sy, sc, sz] = proj(rx, ry, rz);
      if (sc > 0.1) drawList.push({ type: 'p', z: sz, x: sx, y: sy, sc, sz: p.size * sc, br: p.brightness, hs: p.hueShift, ly: 'c' });
    }

    // --- Ring particles (layer 2, fades in) ---
    if (ringReveal > 0) {
      for (const p of ringParticles) {
        const nv = noise3d(p.angle + time * morphSpeed * 0.4, p.noiseOffset, time * morphSpeed * 0.3);
        const rd = (p.rDist + nv * morphAmount * 0.3) * baseRadius * spread;
        const px = rd * Math.cos(p.angle + time * 0.04);
        const py = p.yOff * baseRadius * spread + nv * morphAmount * baseRadius * 0.2;
        const pz = rd * Math.sin(p.angle + time * 0.04);
        const [rx, ry, rz] = rotateYXZ(px, py, pz, ringAY, ringAX, ringAZ);
        const [sx, sy, sc, sz] = proj(rx, ry, rz);
        if (sc > 0.05) drawList.push({ type: 'p', z: sz, x: sx, y: sy, sc, sz: p.size * sc * ringReveal, br: p.brightness * ringReveal, hs: p.hueShift, ly: 'r' });
      }
    }

    // --- Accent nodes ---
    for (const n of nodes) {
      const pulse = 0.5 + 0.5 * Math.sin(time * n.pulseSpeed + n.pulsePhase);
      const r = n.r * baseRadius * spread;
      const px = r * Math.sin(n.phi) * Math.cos(n.theta);
      const py = r * Math.sin(n.phi) * Math.sin(n.theta);
      const pz = r * Math.cos(n.phi);
      const [rx, ry, rz] = rotateYXZ(px, py, pz, coreAY, coreAX, coreAZ);
      const [sx, sy, sc, sz] = proj(rx, ry, rz);
      if (sc > 0.1) drawList.push({ type: 'n', z: sz, x: sx, y: sy, sc, size: n.size * sc * (0.5 + pulse * 0.5) * glowPower, hue: n.hue, pulse });
    }

    // --- Orbiting streaks (layer 6, fades in at ~55%) ---
    if (streakReveal > 0) {
      for (const st of streaks) {
        const trailPts = [];
        for (let ti = 0; ti < st.trailLen; ti++) {
          const tBack = ti * 0.035;
          const angle = time * st.orbitSpeed + st.orbitPhase - tBack;
          const r = st.orbitRadius * baseRadius * spread;
          const px = r * Math.cos(angle);
          const py = r * Math.sin(angle) * Math.cos(st.orbitTilt) * 0.5;
          const pz = r * Math.sin(angle) * Math.sin(st.orbitTilt);
          const [rx, ry, rz] = rotateYXZ(px, py, pz, coreAY * 0.8, coreAX * 0.6, coreAZ * 0.4);
          const [sx, sy, sc, sz] = proj(rx, ry, rz);
          trailPts.push({ sx, sy, sc, sz, t: ti / st.trailLen });
        }
        const avgZ = trailPts.reduce((s, p) => s + p.sz, 0) / trailPts.length;
        drawList.push({ type: 'streak', z: avgZ, points: trailPts, hue: st.hue, reveal: streakReveal });
      }
    }

    // --- Depth sort ---
    drawList.sort((a, b) => b.z - a.z);

    // --- Draw all ---
    for (const item of drawList) {
      if (item.type === 'fil') {
        const pts = item.points;
        if (pts.length < 2) continue;

        // Smooth bezier curve through points
        ctx.beginPath();
        ctx.moveTo(pts[0].sx, pts[0].sy);
        for (let i = 1; i < pts.length - 1; i++) {
          const xc = (pts[i].sx + pts[i + 1].sx) / 2;
          const yc = (pts[i].sy + pts[i + 1].sy) / 2;
          ctx.quadraticCurveTo(pts[i].sx, pts[i].sy, xc, yc);
        }
        ctx.lineTo(pts[pts.length - 1].sx, pts[pts.length - 1].sy);

        const fh = baseHue + item.hue + warmth * (warmHue - baseHue);
        ctx.strokeStyle = `hsla(${fh}, 55%, ${22 + glowPower * 22}%, ${0.06 + glowPower * 0.1})`;
        ctx.lineWidth = item.lw * (0.7 + glowPower * 0.3);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();

        // Wide glow pass
        ctx.strokeStyle = `hsla(${fh}, 45%, ${35 + glowPower * 15}%, ${0.015 + glowPower * 0.025})`;
        ctx.lineWidth = item.lw * 4;
        ctx.stroke();
      }

      if (item.type === 'p') {
        const hue = baseHue + item.hs + warmth * (warmHue - baseHue);
        const isCore = item.ly === 'c';
        const isRing = item.ly === 'r';
        const sat = isCore ? (50 + item.br * 25) : isRing ? (35 + item.br * 20) : (40 + item.br * 20);
        const light = isCore ? (22 + item.br * glowPower * 45) : isRing ? (18 + item.br * glowPower * 25) : (15 + item.br * glowPower * 28);
        const depthF = Math.min(1, Math.max(0.15, item.sc * 1.3));
        const alpha = item.br * (0.15 + glowPower * 0.55) * depthF;
        const radius = item.sz * (1 + glowPower * 0.15);
        if (radius < 0.25) continue;

        // Glow halo
        if (radius > 1.0) {
          const gs = radius * (isCore ? 4.5 : 3);
          const grad = ctx.createRadialGradient(item.x, item.y, 0, item.x, item.y, gs);
          grad.addColorStop(0, `hsla(${hue}, ${sat}%, ${light}%, ${alpha * 0.3})`);
          grad.addColorStop(0.35, `hsla(${hue}, ${sat}%, ${light * 0.5}%, ${alpha * 0.06})`);
          grad.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
          ctx.fillStyle = grad;
          ctx.fillRect(item.x - gs, item.y - gs, gs * 2, gs * 2);
        }

        ctx.beginPath();
        ctx.arc(item.x, item.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${hue}, ${sat}%, ${light}%, ${alpha})`;
        ctx.fill();
      }

      if (item.type === 'n') {
        const hue = baseHue + item.hue + warmth * (warmHue - baseHue);
        const ns = item.size;

        const g3 = ctx.createRadialGradient(item.x, item.y, 0, item.x, item.y, ns * 2.5);
        g3.addColorStop(0, `hsla(${hue}, 65%, 55%, ${item.pulse * glowPower * 0.12})`);
        g3.addColorStop(0.3, `hsla(${hue}, 55%, 35%, ${item.pulse * glowPower * 0.04})`);
        g3.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
        ctx.fillStyle = g3;
        ctx.fillRect(item.x - ns * 2.5, item.y - ns * 2.5, ns * 5, ns * 5);

        const g4 = ctx.createRadialGradient(item.x, item.y, 0, item.x, item.y, ns * 0.4);
        g4.addColorStop(0, `hsla(${hue - 10}, 75%, 75%, ${item.pulse * glowPower * 0.4})`);
        g4.addColorStop(1, `hsla(${hue}, 55%, 35%, 0)`);
        ctx.fillStyle = g4;
        ctx.fillRect(item.x - ns * 0.4, item.y - ns * 0.4, ns * 0.8, ns * 0.8);
      }

      if (item.type === 'streak') {
        const pts = item.points;
        if (pts.length < 2) continue;
        const sh = baseHue + item.hue + warmth * (warmHue - baseHue) - 15;

        // Draw trail as series of segments with fading alpha
        for (let i = 0; i < pts.length - 1; i++) {
          const fade = (1 - pts[i].t) * item.reveal;
          const alpha = fade * glowPower * 0.35;
          if (alpha < 0.01) continue;
          const lw = (1 - pts[i].t) * 3 * item.reveal;

          ctx.beginPath();
          ctx.moveTo(pts[i].sx, pts[i].sy);
          ctx.lineTo(pts[i + 1].sx, pts[i + 1].sy);
          ctx.strokeStyle = `hsla(${sh}, 70%, ${50 + glowPower * 20}%, ${alpha})`;
          ctx.lineWidth = lw;
          ctx.lineCap = 'round';
          ctx.stroke();
        }

        // Bright head
        const head = pts[0];
        const headSize = 4 * item.reveal * glowPower;
        const hg = ctx.createRadialGradient(head.sx, head.sy, 0, head.sx, head.sy, headSize * 3);
        hg.addColorStop(0, `hsla(${sh}, 80%, 80%, ${item.reveal * glowPower * 0.5})`);
        hg.addColorStop(0.4, `hsla(${sh}, 60%, 50%, ${item.reveal * glowPower * 0.15})`);
        hg.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
        ctx.fillStyle = hg;
        ctx.fillRect(head.sx - headSize * 3, head.sy - headSize * 3, headSize * 6, headSize * 6);
      }
    }

    // --- Core radiance ---
    const cs = baseRadius * (0.2 + glowPower * 0.12);
    const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, cs);
    cg.addColorStop(0, `rgba(${150 + Math.floor(warmth * 50)}, ${80 + Math.floor(warmth * 25)}, ${200}, ${glowPower * 0.08})`);
    cg.addColorStop(0.35, `rgba(${70 + Math.floor(warmth * 30)}, ${25}, ${130}, ${glowPower * 0.03})`);
    cg.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = cg;
    ctx.fillRect(0, 0, w, h);

    // --- Vignette ---
    const vig = ctx.createRadialGradient(cx, cy, h * 0.18, cx, cy, h * 0.92);
    vig.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vig.addColorStop(1, 'rgba(0, 0, 0, 0.5)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, w, h);
  };
}

// --- Ocean renderer ---

function createOceanRenderer(width, height) {
  const layers = [
    { amplitude: 0.08, frequency: 0.006, speed: 0.4, phase: 0 },
    { amplitude: 0.05, frequency: 0.012, speed: 0.7, phase: 2.1 },
    { amplitude: 0.03, frequency: 0.025, speed: 1.1, phase: 4.3 },
    { amplitude: 0.015, frequency: 0.05, speed: 1.8, phase: 1.7 },
  ];

  const deepColor = { r: 4, g: 12, b: 36 };
  const midColor = { r: 8, g: 32, b: 72 };
  const surfaceColor = { r: 20, g: 60, b: 110 };
  const foamColor = { r: 180, g: 210, b: 235 };
  const highlightColor = { r: 255, g: 255, b: 255 };

  return function renderFrame(ctx, frameIndex, energy, time) {
    const w = width;
    const h = height;
    const waveMultiplier = 0.5 + energy * 2.5;
    const foamThreshold = 0.7 - energy * 0.4;
    const colorShift = energy * 0.3;
    const turbulence = energy * 0.015;

    const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
    bgGrad.addColorStop(0, `rgb(${deepColor.r}, ${deepColor.g}, ${deepColor.b})`);
    bgGrad.addColorStop(0.3, `rgb(${Math.floor(deepColor.r + colorShift * 20)}, ${Math.floor(deepColor.g + colorShift * 30)}, ${Math.floor(deepColor.b + colorShift * 40)})`);
    bgGrad.addColorStop(1, `rgb(${midColor.r}, ${midColor.g}, ${midColor.b})`);
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    const numLines = 80;
    for (let line = 0; line < numLines; line++) {
      const t = line / numLines;
      const yBase = h * (0.15 + t * t * 0.8);
      const lineWidth = 1 + t * 2;
      const alpha = 0.15 + t * 0.5;

      ctx.beginPath();
      ctx.lineWidth = lineWidth;

      for (let x = 0; x <= w; x += 3) {
        let displacement = 0;
        for (const layer of layers) {
          const amp = layer.amplitude * waveMultiplier * (0.3 + t * 0.7) * h;
          const freq = layer.frequency * (1 + t * 0.5);
          displacement += amp * Math.sin(freq * x + layer.speed * time + layer.phase + line * 0.3);
        }
        if (turbulence > 0) {
          displacement += Math.sin(x * 0.08 + time * 3 + line) * turbulence * h * (0.5 + t);
        }
        const y = yBase + displacement;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }

      const r = Math.floor(surfaceColor.r + (foamColor.r - surfaceColor.r) * t * colorShift);
      const g = Math.floor(surfaceColor.g + (foamColor.g - surfaceColor.g) * t * colorShift);
      const b = Math.floor(surfaceColor.b + (foamColor.b - surfaceColor.b) * t * colorShift);
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
      ctx.stroke();
    }

    const glowRadius = h * 0.3 + energy * h * 0.2;
    const glowX = w * 0.5 + Math.sin(time * 0.1) * w * 0.1;
    const glowY = h * 0.08;
    const glowGrad = ctx.createRadialGradient(glowX, glowY, 0, glowX, glowY, glowRadius);
    glowGrad.addColorStop(0, `rgba(${highlightColor.r}, ${highlightColor.g}, ${highlightColor.b}, ${0.03 + energy * 0.06})`);
    glowGrad.addColorStop(0.5, `rgba(${surfaceColor.r + 40}, ${surfaceColor.g + 40}, ${surfaceColor.b + 40}, ${0.01 + energy * 0.03})`);
    glowGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glowGrad;
    ctx.fillRect(0, 0, w, h);

    const vigGrad = ctx.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, h * 0.9);
    vigGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vigGrad.addColorStop(1, 'rgba(0, 0, 0, 0.4)');
    ctx.fillStyle = vigGrad;
    ctx.fillRect(0, 0, w, h);
  };
}

// --- Main ---

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!opts.audioFile) {
    console.error('Usage: node src/visualizer.mjs <audio-file> [options]');
    console.error('');
    console.error('Generates audio-reactive animated video for social media.');
    console.error('');
    console.error('Options:');
    console.error('  --style NAME      Visual style: nebula, ocean (default: nebula)');
    console.error('  --platform NAME   Platform preset (default: instagram-story)');
    console.error('  --output FILE     Output path (default: output/<name>_viz.mp4)');
    console.error('  --fps N           Frame rate (default: 30)');
    console.error('  --width N         Width override');
    console.error('  --height N        Height override');
    process.exit(1);
  }

  const audioPath = path.resolve(opts.audioFile);
  if (!fs.existsSync(audioPath)) {
    throw new Error(`File not found: ${audioPath}`);
  }

  // Platform settings
  const platform = PLATFORMS[opts.platform];
  if (!platform) {
    throw new Error(`Unknown platform: ${opts.platform}. Available: ${Object.keys(PLATFORMS).join(', ')}`);
  }

  const width = opts.width || platform.width;
  const height = opts.height || platform.height;
  const fps = opts.fps;

  console.log(`\nAnalyzing audio...`);
  const audio = await analyzeAudio(audioPath, { fps, smoothing: 7 });
  console.log(`  Duration: ${audio.duration.toFixed(1)}s`);
  console.log(`  Frames: ${audio.totalFrames} @ ${fps}fps`);
  console.log(`  Peak RMS: ${audio.peak.toFixed(4)}`);

  // Output path
  const outputPath = opts.output
    ? path.resolve(opts.output)
    : path.resolve('output', path.basename(audioPath, path.extname(audioPath)) + `_${opts.style}_${opts.platform}.mp4`);

  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Create renderer
  console.log(`\nRendering ${opts.style} @ ${width}x${height} for ${opts.platform}...`);
  let renderer;
  switch (opts.style) {
    case 'nebula':
      renderer = createNebulaRenderer(width, height);
      break;
    case 'ocean':
      renderer = createOceanRenderer(width, height);
      break;
    default:
      throw new Error(`Unknown style: ${opts.style}. Available: nebula, ocean`);
  }

  // Create canvas
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Spawn ffmpeg encoder
  const ffmpegArgs = [
    '-y',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgba',
    '-s', `${width}x${height}`,
    '-r', String(fps),
    '-i', 'pipe:0',       // video from stdin
    '-i', audioPath,       // audio from file
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-b:v', platform.videoBitrate,
    '-maxrate', platform.videoBitrate,
    '-bufsize', String(parseInt(platform.videoBitrate) * 2) + 'M',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', platform.audioBitrate,
    '-ar', String(platform.audioRate),
    '-shortest',
    '-movflags', '+faststart',
    outputPath,
  ];

  const ffmpeg = spawn('ffmpeg', ffmpegArgs, { stdio: ['pipe', 'pipe', 'pipe'] });

  let ffmpegErr = '';
  ffmpeg.stderr.on('data', (d) => { ffmpegErr += d.toString(); });

  // Render frames
  const startTime = Date.now();
  let lastLog = 0;

  for (let f = 0; f < audio.totalFrames; f++) {
    const time = f / fps;
    const energyCtx = {
      raw: audio.energy[f],
      slow: audio.energySlow[f],
      glacial: audio.energyGlacial[f],
      progress: f / audio.totalFrames,  // 0.0 to 1.0 through the song
    };

    // Clear and render
    ctx.clearRect(0, 0, width, height);
    renderer(ctx, f, energyCtx, time);

    // Write raw RGBA to ffmpeg
    const imageData = ctx.getImageData(0, 0, width, height);
    const written = ffmpeg.stdin.write(Buffer.from(imageData.data.buffer));

    // Backpressure handling
    if (!written) {
      await new Promise((resolve) => ffmpeg.stdin.once('drain', resolve));
    }

    // Progress
    const now = Date.now();
    if (now - lastLog > 2000) {
      const pct = ((f / audio.totalFrames) * 100).toFixed(0);
      const elapsed = ((now - startTime) / 1000).toFixed(1);
      const framesPerSec = (f / ((now - startTime) / 1000)).toFixed(0);
      process.stdout.write(`\r  ${pct}% (${f}/${audio.totalFrames} frames, ${framesPerSec} fps, ${elapsed}s elapsed)`);
      lastLog = now;
    }
  }

  // Close stdin and wait for ffmpeg
  ffmpeg.stdin.end();
  await new Promise((resolve, reject) => {
    ffmpeg.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}\n${ffmpegErr}`));
    });
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const fileSize = (fs.statSync(outputPath).size / (1024 * 1024)).toFixed(1);
  console.log(`\r  Done! ${audio.totalFrames} frames in ${elapsed}s`);
  console.log(`\nOutput: ${outputPath}`);
  console.log(`  ${width}x${height}, ${fps}fps, ${audio.duration.toFixed(1)}s, ${fileSize}MB`);
  console.log(`  Platform: ${opts.platform} (${platform.videoBitrate} video, ${platform.audioBitrate} audio)`);
  console.log(`\nOpen with: open '${outputPath}'`);
}

main().catch((err) => {
  console.error('\nFATAL:', err.message);
  process.exit(1);
});
