# Phase 1 local development

## Prerequisites

- Node.js 22 and npm
- Docker Desktop (required by the Supabase CLI and MinIO Compose service)
- A Trigger.dev account/project for the real durable-worker path

## Setup

1. Copy `.env.example` to `.env` and set non-production local credentials.
2. Run `npm ci`.
3. Run `npm run db:start`; copy the printed publishable and service-role keys into `.env`.
4. Run `npm run db:reset` to replay migrations and test seed data.
5. Run `npm run infra:start` to start MinIO and create the private, versioned artifact bucket.
6. Run `npm run dev` for the Studio.
7. Run the Trigger.dev development command documented by `apps/worker` once that milestone is installed.

Mail from local Supabase Auth appears in Inbucket at `http://127.0.0.1:54324`. The MinIO console is at `http://127.0.0.1:9001`.

Do not reuse local credentials in Vercel, Supabase, AWS, or Trigger.dev. `.env` is ignored and must never be committed.

## Milestone 4 database boundary

The three initial migrations create the 13 approved persistence tables, membership-based
RLS, immutable revision/artifact/history guards, transactional product/revision/enqueue
commands, and private worker functions. They are an initial schema, not an upgrade from
an existing deployed database. Subsequent deployed changes need new forward migrations.

Run the real local validation before changing database contracts:

```sh
npm run db:start
npm run db:reset
npm run db:test
```

`db:reset` destroys this project's local development database. The seed deliberately
contains no owner, passwords, templates, or creative catalogs. Behavioral pgTAP fixtures
create users and tenant data inside rollback transactions. Their temporary worker-role
grants exist only to exercise the production function grants and roll back with the data.

Operational contracts for later adapters:

- With public signup disabled, invite the intended owner first through a trusted Supabase
  administrator. The first Auth user creates the owner account; later Auth users receive
  no account membership automatically. This bootstrap is database plumbing, not a login UI.
- Authenticated sessions can read their own account's rows and invoke the three closed
  product/revision/enqueue commands; they cannot directly mutate tables or call workers.
- `atelier_worker` is a NOLOGIN role with only private function execution. Provision a
  dedicated server-only login with permission to assume this role when implementing the
  worker adapter. Do not use the Supabase service-role key as the worker permission model.
- Enqueue replay returns the original job even after the current revision advances. A new
  idempotency key can build only the current revision. Reusing a key for different work fails.
- Claiming an outbox item transitions queued to dispatched (dispatch has begun). Binding
  records the provider run separately. A worker attempt can start only after binding;
  an early provider callback must retry that database step. Lease tokens expire against
  wall-clock time, and reclaims rotate them. The tenth reported dispatch failure marks the
  item dead and the job failed.
- Provider attempt identifiers deduplicate starts. Only one attempt can run at once.
  Progress, completion, and failure use the stable attempt identity; stale attempts cannot
  change a newer attempt's progress or outcome. The provider adapter must report failed or
  crashed attempts before starting their replacements; never silently replace an active
  attempt. Attempt exhaustion is final even if the provider omits its final-failure hint.
- Persist artifact metadata only after upload and byte/hash verification. The database
  validates identity, generated key structure, positive byte length, version, and SHA-256
  syntax; it cannot verify remote object bytes. Artifact completion replay must match the
  original metadata and successful attempt. The SQL revision hash is SHA-256 of PostgreSQL's
  `jsonb::text` representation, not an independently serialized JavaScript object.
- The approved domain transition `failed -> queued` requires a prepared pending outbox,
  remaining attempt/dispatch budget, cleared terminal fields, and no previous workflow
  binding or running attempt. This prevents a state-only update from stranding work.
  Bound or exhausted workflows require a new job identity. No public retry or cancellation
  command is implemented in this milestone; a later retry command must coordinate this
  operation transactionally.

Milestone 5 is the invite-only Supabase magic-link authentication slice: server-side
session handling, validated callback/redirect handling, protected Studio routes,
logout, and authorization tests for the invited owner, anonymous sessions, and users
without membership. It must retain disabled public signup and keep credentials off the
client. Product UI, object-storage adapters, and durable workflow execution follow their
own milestones. Milestone 5 is complete.

## Milestone 6 Products flow

The owner can create a named product from `/products` and open its persisted detail
at `/products/[productId]`. The library reads account-scoped rows with the owner's
session and RLS. Creation calls `create_product_with_revision` through an authenticated,
same-origin Server Action; PostgreSQL owns Revision 1, provenance, schema and hash.
No migration, privileged runtime client, product taxonomy or later workspace is added.

The form disables submission while pending and redirects after success. The existing
command has no idempotency key: replaying a separate request creates another product,
each with exactly one Revision 1. The application never automatically retries an
uncertain write and asks the owner to check the library before trying again.

For local acceptance, reset the disposable development database, run `npm run db:test`,
then run `npm run test:e2e` with `NEXT_PUBLIC_APP_URL`,
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and local
`SUPABASE_SERVICE_ROLE_KEY` set. The last key is used only for local test fixture
provisioning; browser and persistence assertions use authenticated public-key clients.
Tests refuse an unrelated existing owner and never delete fixture data. The empty-state
case requires a fresh reset. The full suite contains nine auth and six Products cases.

## Milestone 7 private artifact storage

`packages/storage` implements the existing `BlobStore` port using the AWS S3 SDK.
The server derives `accounts/<account>/products/<product>/revisions/<revision>/artifacts/<artifact>/payload.txt`
from trusted UUIDs. `uploadVerifiedArtifact` snapshots bytes, calculates SHA-256, uses
`If-None-Match: *` and a SHA-256 transport checksum, requires a non-null version, and reads that exact version back.
It compares content type, metadata digest, declared size, streamed size and the hash
of the actual read-back bytes. ETags are never interpreted as SHA-256. Only successful
verification invokes the caller's database completion boundary. The existing
`private.worker_complete_test_build` command remains the metadata authority; no
schema migration is required.

There is deliberately no production upload UI, worker, dispatcher or generator in
this slice. The deterministic acceptance fixture creates a job/attempt through the
existing commands, uploads actual bytes to MinIO, and completes metadata as
`atelier_worker`. Its local Docker administrator is used only to assume the existing
worker role and provision test accounts; runtime privileges are unchanged. Failed
upload and fault-injected corrupt/incorrect-size readbacks are checked against real
Postgres to confirm no available artifact appears. Fault injection is not a claim
that MinIO corrupted stored data.

Authenticated Product detail shows a minimal download link for available artifacts
on its current revision. `/artifacts/<artifactId>/download` verifies the owner session,
queries the account-scoped artifact under RLS, checks canonical identity and configured
bucket, and only then signs the stored version. Buckets and keys cannot be supplied
by the browser. Missing, malformed and unauthorized requests return the same 404;
backend failures return a sanitized 503. Redirects use `private, no-store` and
`no-referrer`. The signed response forces attachment download and private, no-store caching.

### Local configuration and validation

Use distinct randomly generated local credentials for `MINIO_ROOT_USER` /
`MINIO_ROOT_PASSWORD` (administration) and `AWS_ACCESS_KEY_ID` /
`AWS_SECRET_ACCESS_KEY` (runtime). Do not reuse production credentials. `infra:start`
creates a private, versioned bucket and grants the runtime user only GetObject,
GetObjectVersion and PutObject beneath `accounts/`; it cannot delete objects or
administer the service. `infra/artifact-runtime-policy.json` is the local policy
template. Ports bind only to loopback. Both pinned MinIO images now use Quay because
the previously configured Docker Hub images could not be pulled during acceptance.

Set the existing endpoint, region, bucket and path-style variables from `.env.example`.
`ARTIFACT_SIGNED_URL_TTL_SECONDS` defaults to 60 and must be an integer from 1 to 300.
Endpoint credentials, non-HTTPS remote endpoints and malformed configuration fail
closed. Local HTTP loopback is supported. The app reads storage configuration only
in a server-only module after authorization; provider secrets never enter UI props.

With the environment loaded in your shell (npm does not load the root `.env` for
all test commands):

```sh
npm run infra:start
npm run db:reset
npm run db:test
npm test
npm run test:storage
npm run test:e2e
npm run test:coverage
npm run typecheck
npm run lint
npm run build
npm run guardrails
npm audit --omit=dev
git diff --check
```

The full browser suite must start after a clean disposable database reset. It runs
Auth and Products acceptance before storage fixtures, preserving the existing empty
Products assertion. Storage fixtures leave immutable data in place; do not treat a
second full run without reset as an empty-account test. The browser suite also needs
the local Supabase service-role key solely for test Auth/account provisioning, as
in Milestones 5–6. Real MinIO tests require an explicitly local storage endpoint;
they fail rather than silently skip when unavailable. No live AWS test is implied.

### Production S3 requirements

Provision a private general-purpose S3 bucket with versioning **Enabled**, all four
Block Public Access settings enabled, and Bucket owner enforced object ownership
(ACLs disabled). Omit `OBJECT_STORAGE_ENDPOINT` and use the AWS region; set
`OBJECT_STORAGE_FORCE_PATH_STYLE=false`. Use short-lived role credentials through
the SDK default credential chain where available, or server-only platform secret
configuration. A temporary session token may use `AWS_SESSION_TOKEN`.

Grant runtime identities only the required prefix-scoped `s3:PutObject`,
`s3:GetObject` and `s3:GetObjectVersion` permissions. They must not have object or
version deletion, bucket policy/ACL administration, or permission to suspend
versioning. Do not attach broader policies to the local runtime user either.
Production bucket policy should deny non-TLS access and enforce conditional
PutObject writes (`s3:if-none-match`) as described in
[AWS conditional-write enforcement](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes-enforce.html).
`If-None-Match: *` checks the current version; deletion markers could allow key
reuse, which is why runtime deletion and lifecycle deletion of artifact identities
must remain disabled. Versioning alone does not enforce no-overwrite.

This milestone does not provision or audit a live AWS account. Bucket privacy,
versioning, IAM and policy deployment must be verified before production use.
MinIO acceptance verifies actual local privacy and denied deletion; the SDK adapter
never sets public ACLs or grants anonymous access.

### Failure and recovery limits

Storage and Postgres do not share a transaction. A failed verification or database
completion can leave a private unreferenced object. The adapter never deletes it or
retries an uncertain write automatically, and a repeated put to the same existing
key fails, even for identical bytes. Recovery/reconciliation belongs to the later
durable workflow slice and must preserve immutable identities. Database completion
itself retains its existing exact-metadata replay behavior.

Real MinIO concurrent-write acceptance reproduced a stale keep-alive socket reset
after a conditional rejection. Storage requests now use fresh TCP/TLS connections
with one attempt; this deliberately trades connection reuse for predictable
Phase 1 behavior without retrying uncertain writes.

Signed URLs are bearer capabilities until expiry; logout or later membership changes
do not revoke a URL already issued. Do not log or persist them, and disable capture
of download response headers in production observability. Object Lock, cross-region
recovery, user uploads, generation and durable test builds remain deferred.
