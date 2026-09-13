import { defineConfig } from '@playwright/test';

const portOffset = Number(process.env.VITE_SUPERDOC_EXAMPLE_PORT_OFFSET ?? '0');
const collaborationPort = 1234 + portOffset;
const previewPort = 4181 + portOffset;

export default defineConfig({
  testDir: './tests',
  testIgnore: ['**/persistence.spec.ts', '**/access.spec.ts'],
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${previewPort}`,
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'tsx server.ts',
      port: collaborationPort,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `pnpm run build && pnpm run preview --host 127.0.0.1 --port ${previewPort} --strictPort`,
      url: `http://127.0.0.1:${previewPort}`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
