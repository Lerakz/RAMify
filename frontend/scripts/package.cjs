/**
 * Build script that works around electron-builder 26.x winCodeSign symlink bug on Windows.
 * The app is always fully packaged before electron-builder fails on winCodeSign,
 * so we swallow that specific failure and zip the output ourselves.
 */
const { execSync, spawnSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const root       = path.join(__dirname, '..');
const unpackedDir = path.join(root, 'dist-app', 'win-unpacked');
const outZip     = path.join(root, 'dist-app', 'RAMify-windows.zip');

function run(cmd, opts = {}) {
  return spawnSync(cmd, { shell: true, stdio: 'inherit', cwd: root, ...opts });
}

// 0. Clean previous output using Python — handles Windows file permission quirks reliably.
const distAppDir = path.join(root, 'dist-app');
if (fs.existsSync(distAppDir)) {
  const cleanScript = `
import shutil, os
d = r'${distAppDir.replace(/\\/g, '\\\\')}'
for rt, dirs, files in os.walk(d):
    for f in files:
        try: os.chmod(os.path.join(rt, f), 0o777)
        except: pass
shutil.rmtree(d, ignore_errors=True)
  `.trim();
  spawnSync('python', ['-c', cleanScript], { stdio: 'inherit' });
}

// 1. Vite build
console.log('\n── Vite build ─────────────────────────────');
const viteBuild = run('vite build');
if (viteBuild.status !== 0) process.exit(viteBuild.status);

// 2. electron-builder — packages the app into win-unpacked BEFORE failing on winCodeSign.
//    We accept exit code 1 as long as win-unpacked was created.
console.log('\n── electron-builder ────────────────────────');
run('electron-builder --win');

const exePath = path.join(unpackedDir, 'RAMify.exe');
if (!fs.existsSync(exePath)) {
  console.error('\nERROR: dist-app\\win-unpacked\\RAMify.exe not found — packaging failed before app was created.');
  process.exit(1);
}
console.log('✓ App packaged at dist-app\\win-unpacked\\RAMify.exe');

// Embed the custom icon using the rcedit bundled inside the winCodeSign cache.
// We work on a temp copy first because Windows Defender locks newly-created exes.
const cacheDir  = path.join(process.env.LOCALAPPDATA, 'electron-builder', 'Cache', 'winCodeSign');
const iconPath  = path.join(root, 'assets', 'icon.ico');
const rceditBin = fs.existsSync(cacheDir)
  ? (() => { for (const d of fs.readdirSync(cacheDir)) { const p = path.join(cacheDir, d, 'rcedit-x64.exe'); if (fs.existsSync(p)) return p; } return null; })()
  : null;

if (rceditBin && fs.existsSync(iconPath)) {
  console.log('Embedding icon…');
  const tmpExe = exePath + '.tmp';
  fs.copyFileSync(exePath, tmpExe);
  const rc = spawnSync(rceditBin, [tmpExe, '--set-icon', iconPath], { stdio: 'inherit' });
  if (rc.status === 0) {
    fs.copyFileSync(tmpExe, exePath);
    console.log('✓ Icon embedded in RAMify.exe');
  } else {
    console.warn('  (icon embed failed — exe will use default icon)');
  }
  try { fs.unlinkSync(tmpExe); } catch(_) {}
} else {
  console.warn('  (rcedit not found — skipping icon embed)');
}

// 3. Zip win-unpacked using Python (avoids shell quoting issues on Windows)
console.log('\n── Creating distributable zip ──────────────');
if (fs.existsSync(outZip)) fs.unlinkSync(outZip);

const pyScript = `
import zipfile, os, sys
src = sys.argv[1]
dst = sys.argv[2]
with zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
    for root, dirs, files in os.walk(src):
        for file in files:
            fp = os.path.join(root, file)
            zf.write(fp, os.path.relpath(fp, os.path.dirname(src)))
print('zip ok')
`.trim();

const pyResult = spawnSync('python', ['-c', pyScript, unpackedDir, outZip], {
  stdio: 'inherit', cwd: root,
});
if (pyResult.status !== 0 || !fs.existsSync(outZip)) {
  console.error('\nERROR: Failed to create zip.');
  process.exit(1);
}

const sizeMB = (fs.statSync(outZip).size / 1024 / 1024).toFixed(1);
console.log(`\n✓ Done! dist-app\\RAMify-windows.zip (${sizeMB} MB)`);
console.log('  Friends: extract the zip and double-click RAMify.exe');
