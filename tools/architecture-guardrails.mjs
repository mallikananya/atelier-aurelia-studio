import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const roots = ["apps", "packages"];
const ignoredDirs = new Set([".next", "dist", "node_modules", "coverage"]);
const sourceExtensions = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"]);

const forbidden = [
  {
    name: "Etsy publish capability",
    pattern: /\b(?:publishToEtsy|publishEtsy|etsy[.]publish)\b|(?:^|[^\w])(?:export\s+)?(?:async\s+)?function\s+publish\s*\(/u,
  },
  {
    name: "Arbitrary Etsy/provider payload capability",
    pattern: /\b(?:submitArbitraryPayload|arbitraryEtsyPayload|rawEtsyPayload)\b/u,
  },
  {
    name: "Hard-coded creative catalog architecture",
    pattern: /\b(?:ProductFamily|DesignProfile|PlannerTemplate)\b|\b(?:themes|templates|families|profiles)\s*[:=]\s*\[/u,
  },
];

function extensionOf(path) {
  const match = path.match(/\.[^.]+$/u);
  return match ? match[0] : "";
}

function* walk(path) {
  const stat = statSync(path);

  if (stat.isDirectory()) {
    const name = path.split("/").at(-1);
    if (ignoredDirs.has(name)) return;

    for (const entry of readdirSync(path)) {
      yield* walk(join(path, entry));
    }
    return;
  }

  if (stat.isFile() && sourceExtensions.has(extensionOf(path))) {
    yield path;
  }
}

const violations = [];

for (const root of roots) {
  for (const file of walk(root)) {
    const text = readFileSync(file, "utf8");

    for (const rule of forbidden) {
      if (rule.pattern.test(text)) {
        violations.push(`${rule.name}: ${relative(process.cwd(), file)}`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error("Architecture guardrail violations detected:");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log("Architecture guardrails passed.");
