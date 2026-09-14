import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts", "tests/unit/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: [
        "packages/contracts/src/phase1.ts",
        "packages/core/src/jobs.ts",
        "packages/storage/src/artifact-keys.ts",
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
