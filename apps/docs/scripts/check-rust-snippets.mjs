import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = fileURLToPath(new URL('..', import.meta.url));
const crate = resolve(app, '../../packages/sdk/langs/rust');
const project = mkdtempSync(resolve(tmpdir(), 'superdoc-rust-docs-'));

try {
  mkdirSync(resolve(project, 'src'));
  copyFileSync(resolve(app, 'snippets/headless/rust-accept-changes.rs'), resolve(project, 'src/main.rs'));
  const modules = ['rust-batch-comments', 'rust-handle-errors', 'rust-provision-runtime', 'rust-collaboration'];
  for (const name of modules) {
    copyFileSync(resolve(app, `snippets/headless/${name}.rs`), resolve(project, `src/${name.replaceAll('-', '_')}.rs`));
  }
  writeFileSync(resolve(project, 'src/lib.rs'), modules.map((name) => `pub mod ${name.replaceAll('-', '_')};`).join('\n'));
  writeFileSync(resolve(project, 'Cargo.toml'), `[package]
name = "superdoc-rust-docs"
version = "0.0.0"
edition = "2021"
rust-version = "1.85"

[dependencies]
superdoc-sdk = { path = ${JSON.stringify(crate)} }
serde_json = "1"
tokio = { version = "1", features = ["macros", "rt"] }
`);
  execFileSync('cargo', ['+1.85.0', 'check', '--all-targets', '--manifest-path', resolve(project, 'Cargo.toml')], {
    cwd: crate,
    env: { ...process.env, CARGO_TARGET_DIR: resolve(crate, 'target/docs') },
    stdio: 'inherit',
    timeout: 600_000,
  });
} finally {
  rmSync(project, { recursive: true, force: true });
}
