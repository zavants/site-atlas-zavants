import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

/** Builds the canvas once for the whole suite; english.test.ts and canvas.e2e.test.ts both read dist/canvas. */
export default function setup(): void {
  const root = join(import.meta.dirname, '..');
  execFileSync(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', 'canvas'], {
    cwd: root,
    stdio: 'pipe',
    env: { ...process.env, NODE_ENV: 'production' },
  });
}
