'use strict';

const { app, BrowserWindow, ipcMain, dialog, webContents, net } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const fsp = require('fs/promises');
const { spawn } = require('child_process');
const tts = require('./tts');

// ffmpeg-static resolves to the bundled binary for the current platform.
let ffmpegPath = require('ffmpeg-static');
// When packaged inside an asar archive the binary lives in the unpacked dir.
if (ffmpegPath && ffmpegPath.includes('app.asar')) {
  ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
}

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#1b1d24',
    title: 'Article B-roll Generator',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/* ------------------------------------------------------------------ *
 *  Full-page screenshot of the loaded article (via the webview's
 *  webContents and the Chrome DevTools Protocol).
 * ------------------------------------------------------------------ */
ipcMain.handle('capture-full-page', async (_evt, webContentsId) => {
  const wc = webContents.fromId(webContentsId);
  if (!wc) throw new Error('Could not find the article view to capture.');

  const dbg = wc.debugger;
  let attachedHere = false;
  try {
    if (!dbg.isAttached()) {
      dbg.attach('1.3');
      attachedHere = true;
    }

    const { cssContentSize } = await dbg.sendCommand('Page.getLayoutMetrics');
    const width = Math.max(1, Math.ceil(cssContentSize.width));
    // Chromium caps capture height around the max texture size; clamp to be safe.
    const MAX_H = 16384;
    const height = Math.min(MAX_H, Math.max(1, Math.ceil(cssContentSize.height)));

    const result = await dbg.sendCommand('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width, height, scale: 1 }
    });

    return {
      dataUrl: 'data:image/png;base64,' + result.data,
      width,
      height
    };
  } finally {
    if (attachedHere && dbg.isAttached()) {
      try { dbg.detach(); } catch (_) { /* ignore */ }
    }
  }
});

/* ------------------------------------------------------------------ *
 *  MP4 export. The renderer streams PNG frames one at a time into a
 *  temp directory, then we encode them with ffmpeg.
 * ------------------------------------------------------------------ */
ipcMain.handle('export-begin', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'broll-'));
  return dir;
});

ipcMain.handle('export-frame', async (_evt, { dir, index, dataUrl }) => {
  if (!dir || !dir.startsWith(os.tmpdir())) throw new Error('Invalid frame directory.');
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  const file = path.join(dir, 'frame_' + String(index).padStart(6, '0') + '.png');
  await fsp.writeFile(file, Buffer.from(base64, 'base64'));
  return true;
});

ipcMain.handle('export-encode', async (_evt, { dir, fps, outputPath }) => {
  if (!ffmpegPath) throw new Error('ffmpeg binary not found.');

  const args = [
    '-y',
    '-framerate', String(fps),
    '-i', path.join(dir, 'frame_%06d.png'),
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    outputPath
  ];

  await new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args);
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error('ffmpeg failed (code ' + code + '):\n' + stderr.slice(-2000)));
    });
  });

  // Best-effort cleanup of the temporary frame directory.
  fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  return outputPath;
});

/* ------------------------------------------------------------------ *
 *  Voiceover. Synthesize narration with the OS voice, then assemble a
 *  timeline-aligned audio track and mux it into the exported MP4.
 * ------------------------------------------------------------------ */
function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args);
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => code === 0 ? resolve(stderr)
      : reject(new Error('ffmpeg failed (' + code + '):\n' + stderr.slice(-1200))));
  });
}

function parseDuration(stderr) {
  const m = /Duration:\s*(\d+):(\d+):(\d+\.\d+)/.exec(stderr);
  if (!m) return 0;
  return (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
}

ipcMain.handle('tts-available', async () => {
  const eng = tts.detectEngine();
  return eng ? eng.engine : null;
});

// items: [{ index, text }]. Returns { engine, results:[{ index, wav, duration }] }.
ipcMain.handle('tts-synthesize', async (_evt, { dir, items, voice, rate }) => {
  const engine = tts.detectEngine();
  if (!engine) return { engine: null, results: [] };

  const results = [];
  for (const it of items) {
    const raw = path.join(dir, 'raw_' + it.index + '.' + engine.ext);
    const wav = path.join(dir, 'narr_' + it.index + '.wav');
    try {
      await tts.synthesize(it.text, raw, { engine, voice, rate });
      // Normalise to a uniform PCM wav and read its duration from ffmpeg.
      const stderr = await runFfmpeg(['-y', '-i', raw, '-ar', '22050', '-ac', '1',
        '-c:a', 'pcm_s16le', wav]);
      results.push({ index: it.index, wav, duration: parseDuration(stderr) });
    } catch (err) {
      results.push({ index: it.index, wav: null, duration: 0, error: err.message });
    }
  }
  return { engine: engine.engine, results };
});

// segments: ordered [{ len, wav|null }] spanning the whole timeline.
ipcMain.handle('mux-audio', async (_evt, { dir, videoPath, outputPath, segments }) => {
  const clips = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const clip = path.join(dir, 'seg_' + String(i).padStart(4, '0') + '.wav');
    const len = Math.max(0.05, seg.len).toFixed(3);
    if (seg.wav) {
      // Narration padded with trailing silence to fill the segment exactly.
      await runFfmpeg(['-y', '-i', seg.wav, '-af', 'apad', '-t', len,
        '-ar', '22050', '-ac', '1', '-c:a', 'pcm_s16le', clip]);
    } else {
      await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'anullsrc=r=22050:cl=mono',
        '-t', len, '-c:a', 'pcm_s16le', clip]);
    }
    clips.push(clip);
  }

  const listFile = path.join(dir, 'concat.txt');
  await fsp.writeFile(listFile, clips.map((c) => "file '" + c + "'").join('\n'));
  const fullWav = path.join(dir, 'full.wav');
  await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', fullWav]);

  const tmpOut = outputPath + '.tmp.mp4';
  await runFfmpeg(['-y', '-i', videoPath, '-i', fullWav,
    '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k',
    '-shortest', tmpOut]);
  await fsp.rename(tmpOut, outputPath);

  fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  return outputPath;
});

/* ------------------------------------------------------------------ *
 *  PDF input. Open a local PDF (returned as bytes) or download one
 *  from a URL. Rendering happens in the renderer via PDF.js.
 * ------------------------------------------------------------------ */
ipcMain.handle('open-pdf-dialog', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Open a PDF article',
    properties: ['openFile'],
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (res.canceled || !res.filePaths[0]) return null;
  const filePath = res.filePaths[0];
  const buf = await fsp.readFile(filePath);
  return { name: path.basename(filePath), data: new Uint8Array(buf) };
});

ipcMain.handle('download-pdf', async (_evt, url) => {
  if (!/^https?:\/\//i.test(url)) throw new Error('Please provide an http(s) URL.');
  const buf = await new Promise((resolve, reject) => {
    const chunks = [];
    const request = net.request(url);
    request.on('response', (response) => {
      if (response.statusCode >= 400) {
        reject(new Error('Download failed (HTTP ' + response.statusCode + ').'));
        return;
      }
      response.on('data', (c) => chunks.push(c));
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    });
    request.on('error', reject);
    request.end();
  });
  // Light sanity check that we actually got a PDF.
  if (buf.slice(0, 5).toString('latin1') !== '%PDF-') {
    throw new Error('That URL did not return a PDF file.');
  }
  let name = 'document.pdf';
  try { name = path.basename(new URL(url).pathname) || name; } catch (_) { /* ignore */ }
  return { name, data: new Uint8Array(buf) };
});

ipcMain.handle('choose-export-path', async () => {
  const res = await dialog.showSaveDialog(mainWindow, {
    title: 'Export B-roll as MP4',
    defaultPath: path.join(app.getPath('videos') || os.homedir(), 'broll.mp4'),
    filters: [{ name: 'MP4 Video', extensions: ['mp4'] }]
  });
  return res.canceled ? null : res.filePath;
});

ipcMain.handle('export-cancel-cleanup', async (_evt, dir) => {
  if (dir && dir.startsWith(os.tmpdir())) {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  return true;
});
