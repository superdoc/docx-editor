#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { npmDistRoot: distRoot } = require('./build-output-paths.cjs');
const { auditInternalVue } = require('./audit-internal-vue.cjs');
const prosemirrorFingerprint = 'ProseMirror expects the CSS white-space property to be set';
const bundledKonvaFingerprint = /Several Konva instances detected|node_modules\/(?:\.pnpm\/)?konva[@/]/;
const esKonvaImport = /\bfrom\s*["']konva["']/;
const cjsKonvaRequire = /\brequire\(\s*["']konva(?:\/[^"']*)?["']\s*\)/;
const failures = [];
let cjsBundlesKonva = false;

if (!fs.existsSync(distRoot)) {
  throw new Error('Missing dist directory');
}

try {
  auditInternalVue(
    ['superdoc.es.js', 'superdoc.cjs', 'public/ui.es.js', 'public/ui.cjs'].map((file) => path.join(distRoot, file)),
    { vueEntries: ['superdoc.es.js', 'superdoc.cjs'].map((file) => path.join(distRoot, file)) },
  );
} catch (error) {
  failures.push(error.message);
}

for (const file of walkFiles(distRoot)) {
  const relative = path.relative(distRoot, file).split(path.sep).join('/');
  if (/^(?:browser|collaboration|dom)-worker-entry-/.test(path.basename(file))) {
    failures.push(`${relative} is a DOCX Engine worker asset`);
  }
  if (!/\.[cm]?js$/.test(file)) continue;
  const source = fs.readFileSync(file, 'utf8');
  const copies = source.split(prosemirrorFingerprint).length - 1;
  if (copies > 1) failures.push(`${relative} contains ${copies} copies of prosemirror-view`);
  if (file.endsWith('.cjs')) {
    if (cjsKonvaRequire.test(source)) failures.push(`${relative} requires the ES-module-only konva package`);
    if (bundledKonvaFingerprint.test(source)) cjsBundlesKonva = true;
  } else if (bundledKonvaFingerprint.test(source)) {
    failures.push(`${relative} bundles konva instead of importing the dependency`);
  }
}

const esEntry = path.join(distRoot, 'superdoc.es.js');
if (fs.existsSync(esEntry) && !esKonvaImport.test(fs.readFileSync(esEntry, 'utf8'))) {
  failures.push('superdoc.es.js does not import the konva dependency');
}
if (!cjsBundlesKonva) failures.push('CommonJS output does not include konva for the whiteboard renderer');

for (const budget of [
  { file: 'superdoc.es.js', soft: 3_145_728, hard: 4_194_304 },
  { file: 'superdoc.cjs', soft: 3_145_728, hard: 4_194_304 },
  { file: 'style.css', soft: 153_600, hard: 204_800 },
]) {
  const filePath = path.join(distRoot, budget.file);
  if (!fs.existsSync(filePath)) {
    failures.push(`missing ${budget.file}`);
    continue;
  }
  const size = fs.statSync(filePath).size;
  if (size > budget.hard) failures.push(`${budget.file} exceeds ${Math.round(budget.hard / 1024)} KB`);
  else if (size > budget.soft) console.warn(`[audit-npm-bundle] ${budget.file} is ${Math.round(size / 1024)} KB`);
}

if (failures.length > 0) {
  console.error('[audit-npm-bundle] npm bundle failed:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log('[audit-npm-bundle] SuperDoc npm output keeps the DOCX Engine external');

function* walkFiles(root) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) yield* walkFiles(absolute);
    else if (entry.isFile()) yield absolute;
  }
}
