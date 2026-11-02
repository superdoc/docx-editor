import { readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vite-plus/test';

const packageRoot = path.resolve(__dirname, '../..');

function declarationProgramFiles(): string[] {
  const configPath = path.join(packageRoot, 'tsconfig.json');
  const { config } = ts.readConfigFile(configPath, ts.sys.readFile);
  return ts.parseJsonConfigFileContent(config, ts.sys, packageRoot, undefined, configPath).fileNames;
}

describe('src/test-support', () => {
  it('stays out of the package declaration program, so its fixtures never ship as declarations', () => {
    const supportFiles = readdirSync(__dirname).filter((name) => name.endsWith('.ts'));
    expect(supportFiles).toContain('dom-rect.ts');
    expect(declarationProgramFiles().filter((file) => file.includes('/src/test-support/'))).toEqual([]);
  });
});
