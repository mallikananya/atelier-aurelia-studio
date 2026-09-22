import { defineConfig } from '@trigger.dev/sdk';

const project = process.env.TRIGGER_PROJECT_REF;
if (!project || !/^proj_[a-zA-Z0-9]+$/.test(project)) {
  throw new Error('TRIGGER_PROJECT_REF must identify the configured Trigger.dev Cloud project');
}

export default defineConfig({
  project,
  runtime: 'node',
  dirs: ['./src/trigger'],
  maxDuration: 300,
  retries: { enabledInDev: true, default: { maxAttempts: 3, minTimeoutInMs: 130_000,
    maxTimeoutInMs: 180_000, factor: 1.5, randomize: true } },
});
