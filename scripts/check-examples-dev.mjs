#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const publicRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const examplesRoot = path.join(publicRoot, 'examples');
const portOffset = Number(process.env.VITE_SUPERDOC_EXAMPLE_PORT_OFFSET ?? '0');
const firstPort = 5300 + portOffset;
const routes = { collaboration: '/?mode=create&user=Alex' };
const sidecars = { collaboration: ['tsx', 'server.ts'] };

export function findDevExamples(root = examplesRoot) {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => {
      const manifestPath = path.join(root, name, 'package.json');
      if (!existsSync(manifestPath)) return false;
      return typeof JSON.parse(readFileSync(manifestPath, 'utf8')).scripts?.dev === 'string';
    })
    .sort();
}

function start(cwd, args) {
  const child = spawn('pnpm', ['exec', ...args], { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.output = '';
  child.stdout.on('data', (chunk) => (child.output += chunk));
  child.stderr.on('data', (chunk) => (child.output += chunk));
  return child;
}

async function waitForServer(url, servers, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const exited = servers.find((server) => server.exitCode !== null);
    if (exited) throw new Error(`a dev process exited with code ${exited.exitCode}\n${exited.output.trim()}`);
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`the dev server did not answer at ${url}`);
}

function stop(server) {
  if (server.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    server.once('exit', resolve);
    process.kill(-server.pid, 'SIGTERM');
  });
}

async function checkExample(chromium, name, port) {
  const exampleRoot = path.join(examplesRoot, name);
  const origin = `http://127.0.0.1:${port}`;
  const vite = start(exampleRoot, ['vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort', '--force']);
  const servers = [vite, ...(sidecars[name] ? [start(exampleRoot, sidecars[name])] : [])];

  let browser;
  try {
    browser = await chromium.launch();
    await waitForServer(origin, servers, 60_000);
    const page = await browser.newPage();
    const failures = [];
    page.on('response', (response) => {
      if (response.status() >= 400) failures.push(`${response.status()} ${new URL(response.url()).pathname}`);
    });
    page.on('console', (message) => {
      if (message.type() === 'error') failures.push(message.text());
    });
    await page.goto(`${origin}${routes[name] ?? '/'}`);
    try {
      await page.locator('.superdoc-text-run').first().waitFor({ state: 'visible', timeout: 90_000 });
    } catch {
      throw new Error(`the document never rendered\n${failures.join('\n') || vite.output.trim()}`);
    }
  } finally {
    await browser?.close();
    await Promise.all(servers.map(stop));
  }
}

async function main() {
  const require = createRequire(path.join(examplesRoot, 'vanilla', 'package.json'));
  const { chromium } = require('@playwright/test');
  const only = process.argv.slice(2);
  const discovered = findDevExamples();
  const unknown = only.filter((name) => !discovered.includes(name));
  const examples = discovered.filter((name) => only.length === 0 || only.includes(name));
  if (unknown.length > 0 || examples.length === 0) {
    console.error(
      unknown.length > 0 ? `- no example with a dev script named ${unknown.join(', ')}` : '- no examples with a dev script found',
    );
    process.exitCode = 1;
    return;
  }
  const problems = [];
  for (const [index, name] of examples.entries()) {
    try {
      await checkExample(chromium, name, firstPort + index);
      console.log(`ok ${name}`);
    } catch (error) {
      console.log(`not ok ${name}`);
      problems.push(`${name}: ${error.message}`);
    }
  }
  if (problems.length > 0) {
    console.error(problems.map((problem) => `- ${problem}`).join('\n'));
    process.exitCode = 1;
  } else {
    console.log(`Example dev servers: ${examples.length} checked.`);
  }
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) await main();
