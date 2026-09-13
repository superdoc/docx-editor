import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: '**/access.spec.ts',
  webServer: (Array.isArray(base.webServer) ? base.webServer : []).map((server) => ({
    ...server,
    env: { COLLABORATION_DEMO_AUTH: '1', VITE_COLLABORATION_DEMO_AUTH: '1' },
  })),
});
