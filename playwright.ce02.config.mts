import { defineConfig } from '@playwright/test';
import base from './playwright.config.mts';

process.env.CE02_BROWSER_TEST = '1';
const baseURL = 'http://127.0.0.1:3102';
export default defineConfig({
  ...base,
  testMatch: 'ce02-planning.spec.ts',
  use: { ...base.use, baseURL },
  webServer: {
    command: 'npm run dev --workspace=@atelier-aurelia/studio -- --hostname 127.0.0.1 --port 3102',
    url: `${baseURL}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NEXT_PUBLIC_APP_URL: baseURL,
      PLANNING_PROVIDER_URL: 'http://127.0.0.1:3103/plan',
      PLANNING_PROVIDER_ID: 'ce02-browser-fixture',
      PLANNING_PROVIDER_VERSION: 'fixture/1',
      PLANNING_PROMPT_VERSION: 'planning-prompt/1',
    },
  },
});
