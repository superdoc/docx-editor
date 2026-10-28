import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

export async function mapNativeBuilds(targets, build, jobs = 1) {
  assert.ok(Number.isInteger(jobs) && jobs >= 1 && jobs <= 2,
    'Native build concurrency must be one or two');
  const results = new Array(targets.length);
  let next = 0;
  let failed = false;
  let failure;
  await Promise.all(Array.from({ length: Math.min(jobs, targets.length) }, async () => {
    while (!failed && next < targets.length) {
      const index = next++;
      try { results[index] = await build(targets[index]); }
      catch (error) { if (!failed) { failed = true; failure = error; } }
    }
  }));
  if (failed) throw failure;
  return results;
}

const TOOLCHAIN_DOWNLOAD_FAILURE = /Failed to download '[^']+': (ConnectionRefused|ConnectionResetByPeer|ConnectionTimedOut|NetworkUnreachable|Timeout)|Network error downloading executable for '[^']+'/;

function runOnce(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ['inherit', 'inherit', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; process.stderr.write(chunk); });
    child.once('error', reject);
    child.once('close', (code, signal) => code === 0 ? resolve() :
      reject(Object.assign(new Error(`${command} failed: ${signal ?? code}`), { stderr })));
  });
}

export async function runNativeCompiler(command, args, options, { attempts = 3, wait = ms => new Promise(r => setTimeout(r, ms)), run = runOnce } = {}) {
  for (let attempt = 1; ; attempt++) {
    try { return await run(command, args, options); }
    catch (error) {
      if (attempt >= attempts || !TOOLCHAIN_DOWNLOAD_FAILURE.test(error.stderr ?? '')) throw error;
      console.error(`Retrying ${command} after a toolchain download failure (attempt ${attempt + 1} of ${attempts}).`);
      await wait(5_000 * attempt);
    }
  }
}
