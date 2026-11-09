'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Exposed to the MAIN visible window
contextBridge.exposeInMainWorld('spout', {
  start:          (name, w, h) => ipcRenderer.invoke('spout:start', name, w, h),
  stop:           ()           => ipcRenderer.invoke('spout:stop'),
  sendState:      (state)      => ipcRenderer.send('spout:state', state),
  notifyLoadVRM:  (url)        => ipcRenderer.send('spout:notify-vrm', url),
  debug:          ()           => ipcRenderer.invoke('spout:debug'),
  onFps:          (cb)         => ipcRenderer.on('spout:fps', (_, fps) => cb(fps)),
});

// Native Electron APIs for the main window
contextBridge.exposeInMainWorld('electronAPI', {
  openVRM:           () => ipcRenderer.invoke('dialog:open-vrm'),
  getVersion:        () => ipcRenderer.invoke('get-version'),
  openExternal:      (url) => ipcRenderer.send('open-external', url),
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_, info) => cb(info)),
});

// Exposed to the OFFSCREEN spout renderer window (same preload, extra API)
contextBridge.exposeInMainWorld('spoutReceiver', {
  onLoadVRM: (cb) => ipcRenderer.on('spout:load-vrm', (_, url)   => cb(url)),
  onState:   (cb) => ipcRenderer.on('spout:state',    (_, state) => cb(state)),
});
