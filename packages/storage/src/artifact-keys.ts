const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface ArtifactKeyInput {
  accountId: string;
  artifactId: string;
  productId: string;
  revisionId: string;
}

function stableIdentifier(value: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new Error("Artifact storage identifiers must be UUIDs.");
  }

  return value.toLowerCase();
}

export function artifactStorageKey(input: ArtifactKeyInput): string {
  const accountId = stableIdentifier(input.accountId);
  const artifactId = stableIdentifier(input.artifactId);
  const productId = stableIdentifier(input.productId);
  const revisionId = stableIdentifier(input.revisionId);

  return [
    "accounts",
    accountId,
    "products",
    productId,
    "revisions",
    revisionId,
    "artifacts",
    artifactId,
    "payload.txt",
  ].join("/");
}
