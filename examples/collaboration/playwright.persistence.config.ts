import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: '**/persistence.spec.ts',
  webServer: Array.isArray(base.webServer) ? base.webServer.slice(1) : [],
});
