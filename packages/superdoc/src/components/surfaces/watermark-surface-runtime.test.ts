import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, test } from 'vite-plus/test';

test('declares the surface component as unknown so Vue stays out of the published types', () => {
  const sourceFile = resolve(dirname(fileURLToPath(import.meta.url)), 'watermark-surface-runtime.ts');
  const { outputText, diagnostics = [] } = ts.transpileDeclaration(readFileSync(sourceFile, 'utf8'), {
    fileName: sourceFile,
    reportDiagnostics: true,
  });
  expect(diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))).toEqual([]);
  expect(outputText).toContain('component: unknown;');
  expect(outputText).not.toContain('import');
});
