import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { createS3BlobStore, uploadVerifiedArtifact, objectStorageConfigFromEnvironment, artifactSignedUrlTtlFromEnvironment } from "./s3-blob-store.js";
import { artifactStorageKey } from "./artifact-keys.js";
const identity = { accountId: "3b9c05f3-2f35-4cc2-930e-d65d48dc3d34", artifactId: "4f47225b-4fc0-4f96-935e-bf50e73f86f8", productId: "82688c3e-3695-41fd-ae34-4ccd20019b85", revisionId: "9058c7cc-cdef-46a7-9a6f-ac959332236d" };
const bytes = new TextEncoder().encode("verified fixture\n");
const sha256 = createHash("sha256").update(bytes).digest("hex");
const key = artifactStorageKey(identity);
const request = { key, bytes, sha256, mediaType: "text/plain" };
const config = { bucket: "private-artifacts", region: "us-east-1" };
function fixture(overrides = {}) {
    const send = vi.fn().mockResolvedValueOnce({ VersionId: "version-1" }).mockResolvedValueOnce({ VersionId: "version-1", ContentLength: bytes.length, ContentType: "text/plain", Metadata: { sha256 }, Body: { transformToWebStream: () => new Blob([bytes]).stream() }, ...overrides });
    const sign = vi.fn().mockResolvedValue("https://private.example/signed");
    return { send, sign, store: createS3BlobStore(config, { send, sign }) };
}
describe("S3 immutable storage", () => {
    it("writes conditionally and reads exact uploaded version to verify actual bytes", async () => {
        const { store, send } = fixture();
        await expect(store.putImmutable(request)).resolves.toEqual({ key, sha256, sizeBytes: bytes.length, versionId: "version-1" });
        expect(send.mock.calls[0][0]).toBeInstanceOf(PutObjectCommand);
        expect(send.mock.calls[0][0].input).toMatchObject({ IfNoneMatch: "*", ChecksumSHA256: Buffer.from(sha256, "hex").toString("base64"), Bucket: config.bucket, Key: key, Metadata: { sha256 }, ContentLength: bytes.length });
        expect(send.mock.calls[0][0].input).not.toHaveProperty("ACL");
        expect(send.mock.calls[1][0]).toBeInstanceOf(GetObjectCommand);
        expect(send.mock.calls[1][0].input.VersionId).toBe("version-1");
    });
    it.each([{ VersionId: "different" }, { ContentLength: 0 }, { ContentType: "image/png" }, { Metadata: { sha256: "0".repeat(64) } }, { Body: { transformToWebStream: () => new Blob([new Uint8Array(bytes.length)]).stream() } }, { Body: undefined }, { Body: {transformToWebStream: () => new Blob([new Uint8Array(bytes.length + 1)]).stream()} }, { Body: {transformToWebStream: () => new Blob([new Uint8Array(1)]).stream()} }])("rejects verification mismatch %j", async (overrides) => {
        await expect(fixture(overrides).store.putImmutable(request)).rejects.toThrow("Artifact storage verification failed.");
    });
    it.each([undefined, "null", ""])("requires immutable version %s", async (version) => {
        const { store, send } = fixture();
        send.mockReset().mockResolvedValue({ VersionId: version });
        await expect(store.putImmutable(request)).rejects.toThrow("Artifact storage verification failed.");
        expect(send).toHaveBeenCalledTimes(1);
    });
    it.each([{ key: "../../secret" }, { key: key.replace("payload.txt", "other.txt") }, { sha256: "0".repeat(64) }, { mediaType: "text/plain\r\nInjected: x" }, { bytes: new Uint8Array(), sha256: createHash("sha256").digest("hex") }])("rejects invalid input before upload", async (patch) => {
        const { store, send } = fixture();
        await expect(store.putImmutable({ ...request, ...patch })).rejects.toThrow();
        expect(send).not.toHaveBeenCalled();
    });
    it("sanitizes conditional conflict and backend failures", async () => {
        for (const error of [{ name: "PreconditionFailed" }, { message: "secret bucket credentials" }]) {
            const { store, send } = fixture();
            send.mockReset().mockRejectedValue(error);
            await expect(store.putImmutable(request)).rejects.toThrow(error.name ? "Artifact already exists." : "Artifact storage operation failed.");
        }
    });
    it("signs only validated exact versions with short expiration", async () => {
        const { store, sign } = fixture();
        await store.createSignedDownload(key, "version-1", 60);
        expect(sign.mock.calls[0][0].input).toMatchObject({ Bucket: config.bucket, Key: key, VersionId: "version-1", ResponseContentDisposition: "attachment", ResponseCacheControl: "private, no-store" });
        expect(sign.mock.calls[0][1]).toBe(60);
        for (const ttl of [0, 301, 1.5, NaN])
            await expect(store.createSignedDownload(key, "version-1", ttl)).rejects.toThrow();
        await expect(store.createSignedDownload("arbitrary", "version-1", 60)).rejects.toThrow();
        await expect(store.createSignedDownload(key, "null", 60)).rejects.toThrow();
        sign.mockRejectedValue(new Error("secret"));
        await expect(store.createSignedDownload(key, "v", 60)).rejects.toThrow("Artifact storage operation failed.");
    });
    it("persists only verified results and never persists failures", async () => {
        const persist = vi.fn().mockResolvedValue("saved");
        await expect(uploadVerifiedArtifact(fixture().store, identity, bytes, "text/plain", persist)).resolves.toBe("saved");
        expect(persist).toHaveBeenCalledWith({ key, sha256, sizeBytes: bytes.length, versionId: "version-1" });
        persist.mockClear();
        await expect(uploadVerifiedArtifact(fixture({ ContentLength: 0 }).store, identity, bytes, "text/plain", persist)).rejects.toThrow();
        expect(persist).not.toHaveBeenCalled();
    });
    it.each([{ bucket: "" }, { region: "" }, { endpoint: "http://remote.example" }, { endpoint: "not-a-url" }, { endpoint: "https://user:secret@example.com" }, { credentials: { accessKeyId: "", secretAccessKey: "" } }])("validates configuration", patch => {
        expect(() => createS3BlobStore({ ...config, ...patch })).toThrow("Invalid object storage configuration.");
    });
});
describe("storage environment", () => {
    it("maps local config and temporary credentials without client exposure", () => {
        expect(objectStorageConfigFromEnvironment({ OBJECT_STORAGE_BUCKET: "private-artifacts", OBJECT_STORAGE_REGION: "us-east-1", OBJECT_STORAGE_ENDPOINT: "http://127.0.0.1:9000", OBJECT_STORAGE_FORCE_PATH_STYLE: "true", AWS_ACCESS_KEY_ID: "fixture", AWS_SECRET_ACCESS_KEY: "fixture", AWS_SESSION_TOKEN: "fixture" })).toEqual({ bucket: "private-artifacts", region: "us-east-1", endpoint: "http://127.0.0.1:9000", forcePathStyle: true, credentials: { accessKeyId: "fixture", secretAccessKey: "fixture", sessionToken: "fixture" } });
        expect(objectStorageConfigFromEnvironment({ OBJECT_STORAGE_BUCKET: "private-artifacts", OBJECT_STORAGE_REGION: "us-east-1" })).toEqual({ ...config, forcePathStyle: false });
    });
    it.each([{}, { OBJECT_STORAGE_BUCKET: "private-artifacts", OBJECT_STORAGE_REGION: "us-east-1", OBJECT_STORAGE_FORCE_PATH_STYLE: "yes" }, { OBJECT_STORAGE_BUCKET: "private-artifacts", OBJECT_STORAGE_REGION: "us-east-1", AWS_ACCESS_KEY_ID: "partial" }])("rejects incomplete environment", env => expect(() => objectStorageConfigFromEnvironment(env)).toThrow());
    it("honors configured short TTL", () => {
        expect(artifactSignedUrlTtlFromEnvironment({})).toBe(60);
        expect(artifactSignedUrlTtlFromEnvironment({ ARTIFACT_SIGNED_URL_TTL_SECONDS: "300" })).toBe(300);
        for (const value of ["0", "301", "1.5", "abc", ""])
            expect(() => artifactSignedUrlTtlFromEnvironment({ ARTIFACT_SIGNED_URL_TTL_SECONDS: value })).toThrow();
    });
});

it("cancels unread response bytes when provenance headers fail verification", async () => {
    const cancel = vi.fn();
    const store = fixture({ContentLength: 0, Body: {transformToWebStream: () => new ReadableStream({cancel})}}).store;
    await expect(store.putImmutable(request)).rejects.toThrow("Artifact storage verification failed.");
    expect(cancel).toHaveBeenCalledTimes(1);
});
