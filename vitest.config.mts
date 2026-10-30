import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts", "tests/unit/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: [
        "packages/contracts/src/phase1.ts",
        "packages/contracts/src/planning.ts",
        "packages/ai/src/planning.ts",
        "packages/core/src/jobs.ts",
        "packages/workflows/src/**/*.ts",
        "packages/storage/src/artifact-keys.ts",
        "packages/storage/src/s3-blob-store.ts",
        "apps/studio/src/lib/products/downloads.ts",
        "apps/studio/src/lib/products/download-response.ts",
        "apps/studio/src/lib/products/service.ts",
        "apps/studio/src/lib/planning/service.ts",
        "apps/studio/src/lib/planning/provider.ts",
        "apps/studio/src/lib/planning/live-provider.ts",
        "apps/studio/src/lib/planning/persistence.ts",
        "apps/studio/src/app/(protected)/products/planning-actions.ts",
        "apps/studio/src/lib/products/builds.ts",
        "apps/studio/src/app/(protected)/products/build-actions.ts",
        "apps/studio/src/app/(protected)/products/actions.ts",
      ],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
  },
});
