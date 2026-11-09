const { app, BrowserWindow, nativeImage, ipcMain, dialog, shell } = require('electron');
const path  = require('path');
const fs    = require('fs');
const https = require('https');

// ── Update checker ────────────────────────────────────────────────────────────
// When you create your GitHub repo, replace this with 'YourUsername/ramify'
const GITHUB_REPO = 'Lerakz/RAMify';

function isNewerVersion(remote, current) {
  const parse = v => v.replace(/^v/, '').split('.').map(Number);
  const r = parse(remote), c = parse(current);
  for (let i = 0; i < 3; i++) {
    if ((r[i] || 0) > (c[i] || 0)) return true;
    if ((r[i] || 0) < (c[i] || 0)) return false;
  }
  return false;
}

function checkForUpdates() {
  if (GITHUB_REPO.startsWith('YOUR_')) return; // not configured yet
  const options = {
    hostname: 'api.github.com',
    path:     `/repos/${GITHUB_REPO}/releases/latest`,
    headers:  { 'User-Agent': 'RAMify' },
    timeout:  8000,
  };
  https.get(options, (res) => {
    let data = '';
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => {
      try {
        const release = JSON.parse(data);
        if (release.tag_name && isNewerVersion(release.tag_name, app.getVersion())) {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-available', {
              version: release.tag_name.replace(/^v/, ''),
              url:     release.html_url,
            });
          }
        }
      } catch (_) {}
    });
  }).on('error', () => {}).on('timeout', function() { this.destroy(); });
}

// GPU texture sharing — Spout on Windows, Syphon on macOS
let TextureSender = null;
let sendTextureFromPaintEvent = null;
try {
  ({ TextureSender, sendTextureFromPaintEvent } = require('@napolab/texture-bridge-core'));
} catch (e) {
  console.warn('[Spout] texture-bridge-core not available:', e.message);
}

const SPOUT_W = 1280;
const SPOUT_H = 720;

let spoutSender   = null;
let spoutWindow   = null;
let pendingVrmUrl = null;

function stopSpout() {
  if (spoutSender) { try { spoutSender.stop(); } catch (_) {} spoutSender = null; }
  if (spoutWindow) { try { spoutWindow.destroy(); } catch (_) {} spoutWindow = null; }
  console.log('[Spout] Stopped');
}

function createSpoutWindow() {
  if (spoutWindow && !spoutWindow.isDestroyed()) return;

  spoutWindow = new BrowserWindow({
    width:       SPOUT_W,
    height:      SPOUT_H,
    show:        false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      offscreen:        { useSharedTexture: true },
      nodeIntegration:  false,
      contextIsolation: true,
      preload:          path.join(__dirname, 'preload.cjs'),
      webSecurity:      false,
    },
  });

  spoutWindow.webContents.setFrameRate(60);
  spoutWindow.webContents.setBackgroundThrottling(false);
  spoutWindow.webContents.startPainting();

  spoutWindow.webContents.on('console-message', (_ev, level, message) => {
    const tag = ['[DBG]','[INF]','[WRN]','[ERR]'][level] ?? '';
    console.log(`[Spout window ${tag}]`, message);
  });

  let _paintCount = 0;
  let _paintSecCount = 0;
  const _paintFpsTimer = setInterval(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('spout:fps', _paintSecCount);
    }
    _paintSecCount = 0;
  }, 1000);
  spoutWindow.once('closed', () => clearInterval(_paintFpsTimer));

  spoutWindow.webContents.on('paint', (event) => {
    if (!spoutSender) return;
    _paintCount++;
    _paintSecCount++;

    if (!event.texture) {
      if (_paintCount <= 3) console.warn('[Spout] event.texture null on frame', _paintCount);
      return;
    }

    const ti = event.texture.textureInfo;

    // Per-frame ntHandle check for frames 1–5: confirms the GPU handle is a real Buffer
    if (_paintCount <= 5) {
      const ntHandle = ti?.handle?.ntHandle;
      const isBuffer = Buffer.isBuffer(ntHandle);
      console.log(`[Spout] frame ${_paintCount}: ntHandle ${isBuffer ? `Buffer(${ntHandle.length})` : `NOT-Buffer (${typeof ntHandle})`}`);
    }

    try {
      sendTextureFromPaintEvent(spoutSender, ti);
      if (_paintCount <= 5) console.log(`[Spout] frame ${_paintCount} sent ok`);
    } catch (err) {
      if (_paintCount <= 5) console.error('[Spout] send error frame', _paintCount, ':', err.message);
    }

    // MUST release the shared texture or the frame pool drains and painting stops
    try { if (typeof event.texture.release === 'function') event.texture.release(); } catch (_) {}
  });

  spoutWindow.webContents.on('did-finish-load', () => {
    spoutWindow.webContents.startPainting();
    console.log('[Spout] isPainting after startPainting:', spoutWindow.webContents.isPainting());
    console.log('[Spout] did-finish-load pendingVrmUrl:', pendingVrmUrl ? pendingVrmUrl.substring(0, 120) : 'null');
    if (pendingVrmUrl && spoutWindow && !spoutWindow.isDestroyed()) {
      spoutWindow.webContents.send('spout:load-vrm', pendingVrmUrl);
      console.log('[Spout] load-vrm sent from did-finish-load');
    }
  });

  const isDev = !app.isPackaged;
  if (isDev) {
    spoutWindow.loadURL('http://localhost:5173/?spout=1');
  } else {
    spoutWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { query: { spout: '1' } });
  }

  spoutWindow.on('closed', () => { spoutWindow = null; });

  console.log(`[Spout] Offscreen window created ${SPOUT_W}×${SPOUT_H}`);
}

// ── File dialog ──────────────────────────────────────────────────────────────

ipcMain.handle('dialog:open-vrm', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    title: 'Load VRM',
    filters: [{ name: 'VRM Files', extensions: ['vrm'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

// ── Spout IPC handlers ────────────────────────────────────────────────────────

ipcMain.handle('spout:start', (_event, name) => {
  if (!TextureSender || !sendTextureFromPaintEvent) {
    const msg = 'texture-bridge-core not loaded';
    console.warn('[Spout]', msg);
    return { ok: false, error: msg };
  }
  stopSpout();
  try {
    spoutSender = new TextureSender(name, SPOUT_W, SPOUT_H);
    console.log(`[Spout] Sender created: "${name}" ${SPOUT_W}×${SPOUT_H}`);
  } catch (e) {
    console.error('[Spout] Failed to create sender:', e.message);
    return { ok: false, error: e.message };
  }
  createSpoutWindow();
  return { ok: true };
});

ipcMain.handle('spout:stop', () => stopSpout());

ipcMain.on('spout:notify-vrm', (_event, url) => {
  console.log('[Spout] notify-vrm url:', url ? url.substring(0, 120) : 'NULL');
  pendingVrmUrl = url;
  if (!url) {
    console.log('[Spout] no VRM loaded yet — will send when user loads one');
    return;
  }
  if (spoutWindow && !spoutWindow.isDestroyed()) {
    spoutWindow.webContents.send('spout:load-vrm', url);
    console.log('[Spout] load-vrm sent to offscreen window');
  } else {
    console.log('[Spout] offscreen window not ready, buffered VRM url');
  }
});

ipcMain.on('spout:state', (_event, state) => {
  if (spoutWindow && !spoutWindow.isDestroyed()) {
    spoutWindow.webContents.send('spout:state', state);
  }
});

ipcMain.handle('spout:debug', () => {
  if (!spoutWindow || spoutWindow.isDestroyed()) return;
  spoutWindow.show();
  spoutWindow.webContents.openDevTools({ mode: 'detach' });
});

ipcMain.handle('get-version', () => app.getVersion());

ipcMain.on('open-external', (_, url) => {
  if (typeof url === 'string' && url.startsWith('https://github.com/')) {
    shell.openExternal(url);
  }
});

// ── Main window ───────────────────────────────────────────────────────────────

const isDev = !app.isPackaged;
let mainWindow;

function getAppIcon() {
  const p = path.join(app.getAppPath(), 'assets', 'logo.png');
  return fs.existsSync(p) ? nativeImage.createFromPath(p) : undefined;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'RAMify',
    icon: getAppIcon(),
    backgroundColor: '#050508',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.webContents.session.setPermissionRequestHandler((_wc, perm, cb) => {
    cb(['media', 'camera', 'microphone', 'audioCapture', 'videoCapture'].includes(perm));
  });

  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      mainWindow.webContents.toggleDevTools();
    }
  });

  mainWindow.webContents.on('did-finish-load', () => {
    if (!isDev) setTimeout(checkForUpdates, 2000);
    if (!isDev) return;
    const vrmPath = path.join(__dirname, '..', '..', 'Lerakz.vrm');
    if (!fs.existsSync(vrmPath)) return;
    const fsUrl = '/@fs/' + vrmPath.replace(/\\/g, '/');
    mainWindow.webContents.executeJavaScript(
      `window.__autoLoadVRM && window.__autoLoadVRM(${JSON.stringify(fsUrl)}, 'Lerakz');`
    );
  });

  mainWindow.on('closed', () => { stopSpout(); mainWindow = null; });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
