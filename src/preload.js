'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');
const url = require('url');

// Absolute file:// URL to the script we inject into the article <webview>.
const webviewPreloadPath = url.pathToFileURL(
  path.join(__dirname, 'webview-preload.js')
).toString();

contextBridge.exposeInMainWorld('api', {
  webviewPreloadPath,

  captureFullPage: (webContentsId) =>
    ipcRenderer.invoke('capture-full-page', webContentsId),

  openPdf: () => ipcRenderer.invoke('open-pdf-dialog'),
  downloadPdf: (url) => ipcRenderer.invoke('download-pdf', url),

  chooseExportPath: () => ipcRenderer.invoke('choose-export-path'),

  ttsAvailable: () => ipcRenderer.invoke('tts-available'),
  ttsSynthesize: (payload) => ipcRenderer.invoke('tts-synthesize', payload),
  muxAudio: (payload) => ipcRenderer.invoke('mux-audio', payload),

  exportBegin: () => ipcRenderer.invoke('export-begin'),
  exportFrame: (payload) => ipcRenderer.invoke('export-frame', payload),
  exportEncode: (payload) => ipcRenderer.invoke('export-encode', payload),
  exportCancelCleanup: (dir) => ipcRenderer.invoke('export-cancel-cleanup', dir)
});
