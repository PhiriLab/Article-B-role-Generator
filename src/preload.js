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

  chooseExportPath: () => ipcRenderer.invoke('choose-export-path'),

  exportBegin: () => ipcRenderer.invoke('export-begin'),
  exportFrame: (payload) => ipcRenderer.invoke('export-frame', payload),
  exportEncode: (payload) => ipcRenderer.invoke('export-encode', payload),
  exportCancelCleanup: (dir) => ipcRenderer.invoke('export-cancel-cleanup', dir)
});
