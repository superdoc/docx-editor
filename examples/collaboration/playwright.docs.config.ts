import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: 'docs-embed.spec.ts',
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: { trace: 'retain-on-failure' },
});
