import { defineConfig } from '@playwright/test';
import base from './playwright.config.mts';

process.env.CE02_BROWSER_TEST = '1';
const baseURL = 'http://127.0.0.1:3102';
export default defineConfig({
  ...base,
  testMatch: 'ce02-planning.spec.ts',
  use: { ...base.use, baseURL },
  webServer: {
    command: `npm run ${process.env.CE02_BROWSER_PRODUCTION === '1' ? 'start' : 'dev'} --workspace=@atelier-aurelia/studio -- --hostname 127.0.0.1 --port 3102`,
    url: `${baseURL}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NEXT_PUBLIC_APP_URL: baseURL,
      PLANNING_PROVIDER_MODE: 'live',
      PLANNING_LIVE_ENABLED: 'true',
      PLANNING_LIVE_URL: 'http://127.0.0.1:3103/v1/chat/completions',
      PLANNING_LIVE_API_KEY: 'local-fixture-not-a-secret',
      PLANNING_LIVE_MODEL: 'ce022-test-model',
      PLANNING_LIVE_EXPECTED_REQUEST_COST_USD: '0',
      PLANNING_PROVIDER_ID: 'ce02-browser-fixture',
      PLANNING_PROVIDER_VERSION: 'fixture/1',
      PLANNING_PROMPT_VERSION: 'planning-prompt/1',
    },
  },
});
