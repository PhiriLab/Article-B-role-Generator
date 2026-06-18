'use strict';

/* ====================================================================
 *  Text-to-speech using the operating system's built-in voice.
 *  No API keys, no network — works offline in the packaged app.
 *    macOS   -> `say`
 *    Windows -> PowerShell System.Speech
 *    Linux   -> `espeak-ng` (or `espeak`)
 *  Produces a raw audio file per line; callers normalise via ffmpeg.
 * ==================================================================== */

const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

function hasBinary(bin) {
  try {
    const r = spawnSync(bin, ['--version'], { stdio: 'ignore' });
    return !r.error; // ENOENT -> r.error set
  } catch (_) { return false; }
}

// Returns { engine, ext } or null if no usable engine is available.
function detectEngine() {
  if (process.platform === 'darwin') return { engine: 'say', ext: 'aiff' };
  if (process.platform === 'win32') return { engine: 'powershell', ext: 'wav' };
  if (hasBinary('espeak-ng')) return { engine: 'espeak-ng', ext: 'wav' };
  if (hasBinary('espeak')) return { engine: 'espeak', ext: 'wav' };
  return null;
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let err = '';
    p.stderr.on('data', (d) => { err += d.toString(); });
    p.on('error', reject);
    p.on('close', (code) => code === 0 ? resolve() : reject(new Error(cmd + ' exited ' + code + ': ' + err.slice(-400))));
  });
}

// Synthesize `text` into a raw audio file at `rawPath` (extension per engine).
// Returns the path actually written.
async function synthesize(text, rawPath, opts) {
  opts = opts || {};
  const eng = opts.engine || detectEngine();
  if (!eng) throw new Error('no-tts-engine');
  const clean = String(text).replace(/\s+/g, ' ').trim().slice(0, 1200) || ' ';

  if (eng.engine === 'say') {
    const args = ['-o', rawPath];
    if (opts.voice) args.push('-v', opts.voice);
    if (opts.rate) args.push('-r', String(opts.rate));
    args.push(clean);
    await run('say', args);
  } else if (eng.engine === 'powershell') {
    const safe = clean.replace(/'/g, "''");
    const ps = "Add-Type -AssemblyName System.Speech; " +
      "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; " +
      (opts.rate ? '$s.Rate = ' + Math.max(-10, Math.min(10, opts.rate)) + '; ' : '') +
      "$s.SetOutputToWaveFile('" + rawPath.replace(/'/g, "''") + "'); " +
      "$s.Speak('" + safe + "'); $s.Dispose();";
    await run('powershell', ['-NoProfile', '-Command', ps]);
  } else { // espeak / espeak-ng
    const args = ['-w', rawPath];
    if (opts.rate) args.push('-s', String(opts.rate));
    if (opts.voice) args.push('-v', opts.voice);
    args.push(clean);
    await run(eng.engine, args);
  }

  if (!fs.existsSync(rawPath) || fs.statSync(rawPath).size === 0) {
    throw new Error('tts produced no audio');
  }
  return rawPath;
}

module.exports = { detectEngine, synthesize };
