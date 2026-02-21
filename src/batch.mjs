#!/usr/bin/env node
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const PROJECT_ROOT = path.resolve(__dirname, '..');

/**
 * Batch renderer for gp-tab-video.
 *
 * Usage:
 *   node src/batch.mjs <dir-or-files...> [options]
 *
 * Examples:
 *   node src/batch.mjs ~/compositions/*.gp --style playthrough
 *   node src/batch.mjs ~/compositions/ --platform youtube,instagram --tracks 0
 *   node src/batch.mjs song1.gp song2.gp5 --style clean --fps 60
 */

function parseArgs(argv) {
  const opts = {
    inputs: [],
    platforms: [],
    passthrough: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--platform' && argv[i + 1]) {
      opts.platforms = argv[++i].split(',').map(s => s.trim());
    } else if (a.startsWith('--')) {
      opts.passthrough.push(a);
      if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
        opts.passthrough.push(argv[++i]);
      }
    } else {
      opts.inputs.push(a);
    }
  }

  return opts;
}

function resolveInputFiles(inputs) {
  const gpExtensions = new Set(['.gp', '.gp3', '.gp4', '.gp5', '.gp6', '.gp7', '.gpx']);
  const files = [];

  for (const input of inputs) {
    const resolved = path.resolve(input);
    const stat = fs.statSync(resolved, { throwIfNoEntry: false });

    if (!stat) {
      console.error(`Warning: ${input} not found, skipping`);
      continue;
    }

    if (stat.isDirectory()) {
      const entries = fs.readdirSync(resolved);
      for (const entry of entries.sort()) {
        const ext = path.extname(entry).toLowerCase();
        if (gpExtensions.has(ext)) {
          files.push(path.join(resolved, entry));
        }
      }
    } else {
      const ext = path.extname(resolved).toLowerCase();
      if (gpExtensions.has(ext)) {
        files.push(resolved);
      } else {
        console.error(`Warning: ${input} is not a Guitar Pro file, skipping`);
      }
    }
  }

  return files;
}

const opts = parseArgs(process.argv.slice(2));

if (opts.inputs.length === 0) {
  console.error('Usage: node src/batch.mjs <dir-or-files...> [options]');
  console.error('');
  console.error('Renders multiple GP files and/or multiple platform outputs.');
  console.error('');
  console.error('Examples:');
  console.error('  node src/batch.mjs ~/compositions/*.gp --style playthrough');
  console.error('  node src/batch.mjs ~/compositions/ --platform youtube,instagram');
  console.error('  node src/batch.mjs song1.gp song2.gp5 --style clean --fps 60');
  console.error('');
  console.error('All flags from index.mjs are supported (--style, --tracks, --fps, etc.).');
  console.error('Use --platform with commas for multi-platform: --platform youtube,instagram,tiktok');
  process.exit(1);
}

const files = resolveInputFiles(opts.inputs);

if (files.length === 0) {
  console.error('No Guitar Pro files found in the specified inputs.');
  process.exit(1);
}

const platforms = opts.platforms.length > 0 ? opts.platforms : [null];
const totalJobs = files.length * platforms.length;
let completed = 0;
let failed = 0;
const startTime = Date.now();

console.log(`Batch render: ${files.length} file(s) x ${platforms.length} platform(s) = ${totalJobs} job(s)\n`);

for (const file of files) {
  for (const platform of platforms) {
    completed++;
    const basename = path.basename(file, path.extname(file));
    const platformSuffix = platform ? `_${platform}` : '';
    const ext = opts.passthrough.includes('--transparent') ? '.mov' : '.mp4';
    const outputFile = `output/${basename}${platformSuffix}_tab${ext}`;

    const args = [
      'src/index.mjs',
      file,
      ...opts.passthrough,
      ...(platform ? ['--platform', platform] : []),
      outputFile,
    ];

    console.log(`[${completed}/${totalJobs}] ${basename}${platform ? ` (${platform})` : ''}`);

    try {
      execSync(['node', ...args].map(a => `"${a}"`).join(' '), {
        stdio: 'inherit',
        cwd: PROJECT_ROOT,
      });
    } catch (e) {
      console.error(`  FAILED: ${e.message}\n`);
      failed++;
    }
  }
}

const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
console.log(`\nBatch complete: ${totalJobs - failed}/${totalJobs} succeeded in ${elapsed}s`);
if (failed > 0) console.log(`  ${failed} job(s) failed`);
console.log(`  Output: output/`);
