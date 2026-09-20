import "server-only";

import { createS3BlobStore, objectStorageConfigFromEnvironment, artifactSignedUrlTtlFromEnvironment } from "../../../../../packages/storage/src/index";
import type { DownloadStorage } from "./downloads";

export function downloadStorage(): DownloadStorage {
  const config = objectStorageConfigFromEnvironment(process.env);
  const store = createS3BlobStore(config);
  return {
    bucket: config.bucket,
    expiresInSeconds: artifactSignedUrlTtlFromEnvironment(process.env),
    createSignedDownload: (key, versionId, expiresInSeconds) => store.createSignedDownload(key, versionId, expiresInSeconds),
  };
}
