import { defineConfig } from '@playwright/test';

const portOffset = Number(process.env.VITE_SUPERDOC_EXAMPLE_PORT_OFFSET ?? '0');
const previewPort = 4190 + portOffset;

export default defineConfig({
  testDir: './tests',
  workers: 1,
  retries: 0,
  timeout: 240_000,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${previewPort}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `pnpm run build && pnpm run preview --host 127.0.0.1 --port ${previewPort} --strictPort`,
    url: `http://127.0.0.1:${previewPort}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
