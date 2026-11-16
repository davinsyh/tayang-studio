import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const env = { ...process.env };
if (process.platform === 'win32' && !env.CARGO_TARGET_DIR) {
  const target = fileURLToPath(new URL('../apps/desktop/src-tauri/target/', import.meta.url));
  mkdirSync(target, { recursive: true });
  // GNU windres splits include paths at spaces when invoking its preprocessor.
  const quoted = target.replaceAll("'", "''");
  const short = execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    `(New-Object -ComObject Scripting.FileSystemObject).GetFolder('${quoted}').ShortPath`,
  ], { encoding: 'utf8', windowsHide: true }).trim();
  if (/\s/.test(short)) {
    throw new Error('Windows GNU builds require an 8.3 short path for target, or a CARGO_TARGET_DIR without spaces.');
  }
  env.CARGO_TARGET_DIR = short;
}

if (!env.npm_execpath) throw new Error('Run this launcher with pnpm dev:desktop.');
const child = spawn(process.execPath, [
  env.npm_execpath, '--filter', '@tayang/desktop', 'tauri', 'dev',
  '--config', 'src-tauri/tauri.dev.conf.json', ...process.argv.slice(2),
], { cwd: root, env, stdio: 'inherit', windowsHide: true });
child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
