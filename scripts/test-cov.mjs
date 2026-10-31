#!/usr/bin/env node
/*
 * Runs coverage across the whole monorepo through Vite+ (`vp test run`).
 * Usage: npm run test:cov -- [path/glob or flags]
 *
 * Notes:
 * - Aggregates coverage for the superdoc package.
 * - Accepts any Vitest CLI flags and test path globs relative to repo root.
 */
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

const repoRoot = process.cwd();

const vpBin = path.resolve(
  repoRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'vp.cmd' : 'vp'
);

// Pass through any user-provided arguments unchanged
const userArgs = process.argv.slice(2);

// Default coverage opts suitable for the whole monorepo
const coverageExcludePatterns = [
  '**/dist/**',
  '**/examples/**',
  '**/*.d.ts',
  '**/*.test.*',
  '**/*.spec.*',
  '**/vite.config.*',
  '**/index.js',
  '**/types.js',
  '**/main.js',
  '**/main.ts',
  '**/migration_after_0_4_14.js',
];

const defaultCoverageArgs = [
  '--coverage',
  '--coverage.provider=v8',
  '--coverage.reporter=text',
  '--coverage.reporter=lcov',
  '--coverage.reporter=html',
  '--coverage.reporter=json-summary',
  '--coverage.reportsDirectory=coverage',
  ...coverageExcludePatterns.map((pattern) => `--coverage.exclude=${pattern}`),
];

const vpArgs = ['test', 'run', ...defaultCoverageArgs, ...userArgs];

const child = spawn(vpBin, vpArgs, {
  stdio: 'inherit',
  env: process.env,
});

child.on('close', (code) => {
  try {
    if (code === 0) {
      const summaryPath = path.join(repoRoot, 'coverage', 'coverage-summary.json');
      if (fs.existsSync(summaryPath)) {
        const raw = fs.readFileSync(summaryPath, 'utf8');
        const data = JSON.parse(raw);

        const normalize = (p) => p.replaceAll('\\\\', '/');
        const superdocRootAbs = normalize(path.join(repoRoot, 'packages', 'superdoc')) + '/';

        function getTotals(obj) {
          const s = obj.statements || { total: 0, covered: 0 };
          const f = obj.functions || { total: 0, covered: 0 };
          const l = obj.lines || { total: 0, covered: 0 };
          return {
            statements: { total: s.total || 0, covered: s.covered || 0 },
            functions: { total: f.total || 0, covered: f.covered || 0 },
            lines: { total: l.total || 0, covered: l.covered || 0 },
          };
        }

        function pct(covered, total) {
          if (!total || total === 0) return 0;
          return (covered / total) * 100;
        }

        function aggForPackage({ absPrefix, relSegment, relPrefix }) {
          const preAbs = normalize(absPrefix);
          const seg = normalize(relSegment);
          const preRel = normalize(relPrefix);
          let sTot = 0, sCov = 0;
          let fTot = 0, fCov = 0;
          let lTot = 0, lCov = 0;
          for (const [file, obj] of Object.entries(data)) {
            if (file === 'total') continue;
            const fp = normalize(file);
            const isMatch = (
              fp.startsWith(preAbs) ||
              fp.includes(seg) ||
              fp.startsWith(preRel)
            );
            if (!isMatch) continue;
            const t = getTotals(obj);
            sTot += t.statements.total; sCov += t.statements.covered;
            fTot += t.functions.total;  fCov += t.functions.covered;
            lTot += t.lines.total;      lCov += t.lines.covered;
          }
          return {
            statements: pct(sCov, sTot),
            functions: pct(fCov, fTot),
            lines: pct(lCov, lTot),
          };
        }

        const globalTotals = (() => {
          const t = getTotals(data.total || {});
          return {
            statements: pct(t.statements.covered, t.statements.total),
            functions: pct(t.functions.covered, t.functions.total),
            lines: pct(t.lines.covered, t.lines.total),
          };
        })();

        const superDoc = aggForPackage({
          absPrefix: superdocRootAbs,
          relSegment: '/packages/superdoc/',
          relPrefix: 'packages/superdoc/',
        });

        const fmt = (n) => `${n.toFixed(1)} %`;

        console.log('\nGlobal repo test coverage:');
        console.log(`📄 Statements: ${fmt(globalTotals.statements)}`);
        console.log(`🔧 Functions: ${fmt(globalTotals.functions)}`);
        console.log(`📏 Lines: ${fmt(globalTotals.lines)}`);

        console.log('\nsuperdoc package:');
        console.log(`▌📄 Statements: ${fmt(superDoc.statements)}`);
        console.log(`▌🔧 Functions: ${fmt(superDoc.functions)}`);
        console.log(`▌📏 Lines: ${fmt(superDoc.lines)}`);

      }
    }
  } catch {}
  process.exit(code);
});
