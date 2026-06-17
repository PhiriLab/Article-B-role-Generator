'use strict';

const { app, BrowserWindow, ipcMain, dialog, webContents } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const fsp = require('fs/promises');
const { spawn } = require('child_process');

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
