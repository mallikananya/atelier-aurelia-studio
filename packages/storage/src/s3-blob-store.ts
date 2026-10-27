import { Agent as HttpAgent } from "node:http";
import { Agent as HttpsAgent } from "node:https";
import { createHash } from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { artifactStorageKey, type ArtifactKeyInput } from "./artifact-keys.ts";
import type { BlobStore, ImmutablePutRequest, ImmutablePutResult } from "./index.ts";
export interface S3BlobStoreConfig {
    bucket: string;
    region: string;
    endpoint?: string;
    forcePathStyle?: boolean;
    credentials?: {
        accessKeyId: string;
        secretAccessKey: string;
        sessionToken?: string;
    };
}
interface Transport {
    send: S3Client["send"];
    sign: (command: GetObjectCommand, expiresInSeconds: number) => Promise<string>;
}
const operationError = () => new Error("Artifact storage operation failed.");
const verificationError = () => new Error("Artifact storage verification failed.");
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function validateKey(key: string): void {
    const parts = key.split("/");
    const canonical = artifactStorageKey({ accountId: parts[1], productId: parts[3], revisionId: parts[5], artifactId: parts[7], mediaType: parts[8] === "planner.pdf" ? "application/pdf" : "text/plain" });
    if (key !== canonical)
        throw new Error("Invalid artifact storage identity.");
}
function validVersion(version: unknown): version is string {
    return typeof version === "string" && version.trim().length > 0 && version !== "null" && version.length <= 1024 && !/[\r\n]/u.test(version);
}
function validateConfig(config: S3BlobStoreConfig): void {
    const invalid = () => { throw new Error("Invalid object storage configuration."); };
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(config.bucket) || !/^[a-z0-9-]+$/u.test(config.region))
        invalid();
    if (config.credentials && (!config.credentials.accessKeyId.trim() || !config.credentials.secretAccessKey.trim()))
        invalid();
    if (config.endpoint) {
        let endpoint: URL;
        try {
            endpoint = new URL(config.endpoint);
        }
        catch {
            return invalid();
        }
        const local = ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname);
        if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== "/" ||
            (endpoint.protocol !== "https:" && !(local && endpoint.protocol === "http:")))
            invalid();
    }
}
async function verify(transport: Transport, bucket: string, request: ImmutablePutRequest, versionId: string): Promise<ImmutablePutResult> {
    const stored = await transport.send(new GetObjectCommand({ Bucket: bucket, Key: request.key, VersionId: versionId }));
    if (stored.VersionId !== versionId || stored.ContentLength !== request.bytes.byteLength ||
        stored.ContentType !== request.mediaType || stored.Metadata?.sha256 !== request.sha256 || !stored.Body) {
        if (stored.Body) await stored.Body.transformToWebStream().cancel();
        throw verificationError();
    }
    const reader = stored.Body.transformToWebStream().getReader();
    const digest = createHash("sha256");
    let sizeBytes = 0;
    try {
        while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            sizeBytes += chunk.value.byteLength;
            if (sizeBytes > request.bytes.byteLength) throw verificationError();
            digest.update(chunk.value);
        }
    } finally {
        await reader.cancel();
    }
    if (sizeBytes !== request.bytes.byteLength || digest.digest("hex") !== request.sha256) throw verificationError();
    return { key: request.key, sha256: request.sha256, sizeBytes, versionId };
}
export function createS3BlobStore(inputConfig: S3BlobStoreConfig, injected?: Transport): BlobStore {
    const config = { ...inputConfig, ...(inputConfig.credentials ? { credentials: { ...inputConfig.credentials } } : {}) };
    validateConfig(config);
    // Avoid reusing a socket closed by an S3-compatible server after a rejected conditional write.
    // A fresh connection preserves fail-closed single-attempt uploads without retrying uncertain writes.
    const client = new S3Client({ ...config, maxAttempts: 1, requestHandler: {
        httpAgent: new HttpAgent({ keepAlive: false }),
        httpsAgent: new HttpsAgent({ keepAlive: false }),
    } });
    const transport = injected ?? { send: client.send.bind(client), sign: (command: GetObjectCommand, expiresInSeconds: number) => getSignedUrl(client, command, { expiresIn: expiresInSeconds }) };
    return {
        async putImmutable(input) {
            validateKey(input.key);
            // Snapshot the caller's bytes before any await; verification must describe exactly this upload.
            const request = { ...input, bytes: new Uint8Array(input.bytes) };
            if (request.bytes.byteLength === 0 || request.mediaType.length > 255 || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+(?:;[\x20-\x7e]*)?$/iu.test(request.mediaType) || hash(request.bytes) !== request.sha256) {
                throw new Error("Invalid artifact bytes or media type.");
            }
            try {
                const uploaded = await transport.send(new PutObjectCommand({ Bucket: config.bucket, Key: request.key, Body: request.bytes,
                    ChecksumSHA256: Buffer.from(request.sha256, "hex").toString("base64"),
                    ContentType: request.mediaType, ContentLength: request.bytes.byteLength, Metadata: { sha256: request.sha256 }, IfNoneMatch: "*" }));
                if (!validVersion(uploaded.VersionId))
                    throw verificationError();
                return await verify(transport, config.bucket, request, uploaded.VersionId);
            }
            catch (error) {
                if (error instanceof Error && error.message === "Artifact storage verification failed.")
                    throw error;
                if (typeof error === "object" && error !== null && "name" in error && ["PreconditionFailed", "ConditionalRequestConflict"].includes(String(error.name))) {
                    throw new Error("Artifact already exists.");
                }
                throw operationError();
            }
        },
        async createSignedDownload(key, versionId, expiresInSeconds) {
            validateKey(key);
            if (!validVersion(versionId) || !Number.isInteger(expiresInSeconds) || expiresInSeconds < 1 || expiresInSeconds > 300)
                throw new Error("Invalid artifact download request.");
            try {
                return new URL(await transport.sign(new GetObjectCommand({ Bucket: config.bucket, Key: key, VersionId: versionId, ResponseContentDisposition: "attachment", ResponseCacheControl: "private, no-store" }), expiresInSeconds));
            }
            catch {
                throw operationError();
            }
        },
    };
}
/** Database completion belongs to the caller's existing authorized command boundary. */
export async function uploadVerifiedArtifact<T>(store: BlobStore, identity: ArtifactKeyInput, bytes: Uint8Array, mediaType: string, persist: (result: ImmutablePutResult) => Promise<T>): Promise<T> {
    const snapshot = new Uint8Array(bytes);
    const result = await store.putImmutable({ key: artifactStorageKey({ ...identity, mediaType }), bytes: snapshot, mediaType, sha256: hash(snapshot) });
    return persist(result);
}
export function objectStorageConfigFromEnvironment(env: Record<string, string | undefined>): S3BlobStoreConfig {
    const config: S3BlobStoreConfig = {
        bucket: env.OBJECT_STORAGE_BUCKET ?? "", region: env.OBJECT_STORAGE_REGION ?? "",
        ...(env.OBJECT_STORAGE_ENDPOINT ? { endpoint: env.OBJECT_STORAGE_ENDPOINT } : {}),
        forcePathStyle: env.OBJECT_STORAGE_FORCE_PATH_STYLE === "true",
        ...(env.AWS_ACCESS_KEY_ID || env.AWS_SECRET_ACCESS_KEY ? { credentials: { accessKeyId: env.AWS_ACCESS_KEY_ID ?? "", secretAccessKey: env.AWS_SECRET_ACCESS_KEY ?? "", ...(env.AWS_SESSION_TOKEN ? { sessionToken: env.AWS_SESSION_TOKEN } : {}) } } : {}),
    };
    if (env.OBJECT_STORAGE_FORCE_PATH_STYLE && !["true", "false"].includes(env.OBJECT_STORAGE_FORCE_PATH_STYLE))
        throw new Error("Invalid object storage configuration.");
    validateConfig(config);
    return config;
}
export function artifactSignedUrlTtlFromEnvironment(env: Record<string, string | undefined>): number {
    const value = env.ARTIFACT_SIGNED_URL_TTL_SECONDS ?? "60";
    if (!/^[0-9]+$/u.test(value))
        throw new Error("Invalid artifact download expiration configuration.");
    const ttl = Number(value);
    if (!Number.isInteger(ttl) || ttl < 1 || ttl > 300)
        throw new Error("Invalid artifact download expiration configuration.");
    return ttl;
}
