import { createRequire } from 'node:module';
import { describe, expect, it } from 'vite-plus/test';

const require = createRequire(import.meta.url);
const { buildSanitizedPackManifest, resolveEngineVersion } = require('./sanitize-pack-manifest.cjs');

describe('resolveEngineVersion', () => {
  it('requires an exact workspace version inside Orbit', () => {
    expect(resolveEngineVersion('workspace:0.1.0', true)).toBe('0.1.0');
    expect(resolveEngineVersion('workspace:0.1.3-next.1', true)).toBe('0.1.3-next.1');
    expect(() => resolveEngineVersion('0.1.0', true)).toThrow(/workspace:0\.x in Orbit/u);
  });

  it('requires an exact published version in an exported checkout', () => {
    expect(resolveEngineVersion('0.1.0', false)).toBe('0.1.0');
    expect(resolveEngineVersion('0.1.3-next.1', false)).toBe('0.1.3-next.1');
    expect(() => resolveEngineVersion('workspace:0.1.0', false)).toThrow(/exact 0\.x/u);
    expect(() => resolveEngineVersion('^0.1.0', false)).toThrow(/exact 0\.x/u);
  });
});

describe('buildSanitizedPackManifest', () => {
  it('returns a publish-only manifest without mutating the source object', async () => {
    const source = {
      name: 'superdoc',
      version: '1.2.3',
      exports: {
        '.': {
          source: './src/index.js',
          import: './dist/index.js',
          types: { source: './src/index.d.ts', import: './dist/index.d.ts' },
        },
      },
      dependencies: {
        '@superdoc/docx-engine': 'workspace:0.1.3-next.1',
        '@types/mdast': 'catalog:',
        uuid: 'catalog:',
      },
      optionalDependencies: { '@types/ws': 'catalog:' },
      peerDependencies: { yjs: 'catalog:', react: '>=16.8.0' },
      devDependencies: { vite: 'catalog:' },
      scripts: { prepack: 'mutate-source', prepare: 'build', postpack: 'restore', test: 'vp test' },
      unpkg: './dist-cdn/superdoc.min.js',
      jsdelivr: './dist-cdn/superdoc.min.js',
    };
    const before = JSON.stringify(source);

    const options = {
      hasInternalWorkspace: true,
      files: ['dist', 'dist-cdn', 'README.md', 'LICENSE', 'NOTICE'],
      catalog: {
        '@types/mdast': '^4.0.4',
        '@types/ws': '^8.18.1',
        uuid: '^11.1.1',
        yjs: '^13.6.19',
      },
    };
    const packed = buildSanitizedPackManifest(source, options);

    expect(JSON.stringify(source)).toBe(before);
    const recording = [
      `source manifest:\n${JSON.stringify(source, null, 2)}`,
      `options:\n${JSON.stringify(options, null, 2)}`,
      `packed manifest:\n${JSON.stringify(packed, null, 2)}`,
    ].join('\n\n');
    await expect(`${recording}\n`).toMatchFileSnapshot(
      './__snapshots__/sanitize-pack-manifest/orbit-workspace-manifest.txt',
    );
  });

  it('fails closed for missing catalog entries and residual local protocols', () => {
    const base = {
      name: 'superdoc',
      dependencies: { '@superdoc/docx-engine': '0.1.0', '@types/mdast': 'catalog:' },
    };
    expect(() => buildSanitizedPackManifest(base, { hasInternalWorkspace: false, catalog: {} })).toThrow(
      /dependencies\.@types\/mdast uses catalog:.*no string entry/u,
    );
    expect(() =>
      buildSanitizedPackManifest(
        {
          name: 'superdoc',
          dependencies: { '@superdoc/docx-engine': '0.1.0' },
          optionalDependencies: { local: 'workspace:*' },
        },
        { hasInternalWorkspace: false, catalog: {} },
      ),
    ).toThrow(/optionalDependencies\.local must not use local dependency protocol workspace:\*/u);
  });
});
