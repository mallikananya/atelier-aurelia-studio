# Implementation status and handoff

Snapshot: 2026-09-20. Milestones 1–7 are complete; do not treat the remaining Phase 1 acceptance flow as implemented. This document records repository evidence and resume boundaries. Product requirements and architecture remain authoritative in [PRD](PRD.md), [Architecture](ARCHITECTURE.md), [Implementation plan](IMPLEMENTATION_PLAN.md), and [ADR 0003](adr/0003-phase-1-platform.md).

## Intended product and approved architecture

Atelier Aurelia is a private AI-native studio: idea → finished digital product → review and targeted conversational edits → exact release approval → verified Etsy draft. Publication is manual in Etsy. AI owns creative direction and artwork; deterministic services own validation, rendering, packaging, QA, provenance, approval, and marketplace submission.

Approved platform: Next.js on Vercel; invite-only Supabase Auth and Postgres; private AWS S3 with local MinIO; Trigger.dev Cloud v4 for durable execution outside browser/Vercel request lifetimes. These are architecture decisions, not claims that all adapters are operational.

Domain boundaries:

- `apps/studio`: presentation and authenticated application routes.
- `packages/contracts`: versioned Zod contracts, provider-neutral records and ports.
- `packages/core`: state transitions, orchestration and release semantics.
- `packages/ai`: AI roles and structured generation boundaries.
- `packages/storage`: provider-neutral object-storage port and verified private S3/MinIO adapter.
- `packages/etsy`: closed draft-only marketplace boundary.
- `supabase`: durable schema, transactional commands, RLS and private worker functions.

## Completed milestones

The first three labels below summarize the corresponding commits; the repository explicitly names Milestones 4–6 in [Local development](LOCAL_DEVELOPMENT.md). Milestones are slices of Phase 1, not the numbered product phases in the implementation plan.

| Milestone | Status and evidence |
| --- | --- |
| 1 — Platform architecture | Complete: `39df399`, accepted ADR 0003 and Phase 1 architecture. |
| 2 — Local service tooling | Complete: `38fed28`, Supabase/MinIO configuration, environment contract and validation scripts. |
| 3 — Domain contracts | Complete: `9d3bf8f`, Phase 1 Zod contracts, state machine and provider-neutral ports. |
| 4 — Database persistence | Complete: `2893e83`, three initial migrations, 13 tables, transactional commands, RLS, worker APIs and pgTAP. |
| 5 — Invite-only authentication | Complete: `78872bf`, server sessions, protected routes, magic-link confirmation, logout, unit and browser tests. |
| 6 — Persisted Products | Complete: `0f6dae3`, authenticated library, name-only creation through the existing transactional command, immutable current-revision detail, unit/browser/database acceptance tests. |
| 7 — Private immutable storage | Complete: S3-compatible private MinIO adapter, canonical conditional writes, exact-version byte/hash verification before database completion, owner/RLS-authorized short-lived downloads, and real service/browser acceptance. |

Reliability follow-up: `6321259` adds 13 behavioral assertions for delivered-outbox requeue and replay safety. The alleged production defect was **not reproduced**: `2893e83` already includes the requeue guard. No production SQL or migration was changed in this follow-up.

## Database, jobs and outbox

Postgres is authoritative for identity, ownership, state and provenance; object directories are not a database. Product creation atomically inserts immutable revision 1 and its current pointer. Revisions, events and audit history are append-only; attempts permit one terminal transition. New deployed schema changes require forward migrations.

Enqueue atomically creates a stable job and one outbox row. Replaying its idempotency key returns the same job, including after revision advancement or terminal failure; conflicting work with the same key fails. New work must target the current revision. Provider run IDs belong to separate workflow bindings.

Outbox claims use locking and expiring, rotating lease tokens. Claim starts dispatch; binding records delivery. Stale tokens cannot bind or release. The tenth reported dispatch failure dead-letters the item and fails its job. Bound provider attempts deduplicate by provider attempt ID; stale attempts cannot alter replacements, and exhaustion terminalizes the job.

`failed → queued` is allowed only for an **unbound, prepared pending dispatch**, with cleared terminal fields, remaining attempt/dispatch budget, no running attempt, no delivery timestamp and no active lease. A delivered/bound workflow requires a new job identity. A future retry command must coordinate preparation and transition transactionally; no public retry command exists today. Automatically rearming delivered work would violate the existing provider identity/idempotency contract.

The reported failure would arise if a state-only update could queue a job while its outbox stayed delivered. `private.enforce_job_update` already rejects that update. The added regression isolates a final failure with remaining budget and cleared error fields, verifies rejection and unchanged delivery, proves enqueue replay cannot redispatch or duplicate bindings, and verifies a prepared unbound retry is claimable only once while leased. See [behavioral pgTAP](../supabase/tests/database/phase1_behavior.test.sql) and [operational contracts](LOCAL_DEVELOPMENT.md#milestone-4-database-boundary).

Artifact metadata must follow upload and byte/hash verification. SQL checks metadata and SHA-256 syntax, not remote bytes. Revision hashing uses PostgreSQL `jsonb::text`, not arbitrary JavaScript serialization. Preserve server-generated keys, no-overwrite writes, versioning, lineage and authorized short-lived downloads when implementing adapters.

## Authentication and authorization

Public signup is disabled at `[auth]`; email-provider enablement supports invited users. Login also sets `shouldCreateUser: false`. A trusted administrator invites the owner. The first Auth user bootstraps the owner account; later users receive no automatic membership. Control invitation/bootstrap order.

Server-side Supabase sessions use HttpOnly cookies, SameSite=Lax and Secure on HTTPS. Redirect destinations are allowlisted; state-changing auth endpoints require same-origin POSTs. Confirmation requires an explicit POST. Protected routes verify the user and exactly one owner membership, failing closed for anonymous users, nonmembers and unavailable authorization.

RLS scopes records by account membership. Authenticated users can read authorized rows and execute closed product/revision/enqueue commands, not mutate tables directly. `atelier_worker` is a NOLOGIN role limited to private worker functions; a future worker adapter needs a dedicated server-only login capable of assuming it. Do not substitute the service-role key for this permission boundary.

## Milestone 7 implementation and handoff

Started on clean `main` with `HEAD` and `origin/main` at `0f6dae3`; an interrupted
session left the in-progress Milestone 7 files, which were inspected and preserved on
resume. Find the completed implementation commit with
`git log -1 -- packages/storage/src/s3-blob-store.ts`; recheck live branch/status.

The existing BlobStore port now has an S3-compatible adapter. Keys are server-derived
from account/product/revision/artifact UUIDs. Writes snapshot the bytes, calculate
SHA-256, use conditional no-overwrite, require a non-null version ID, and verify the
exact stored version's content type, digest metadata, length and streamed byte hash.
Only then does the upload helper invoke the existing database completion boundary.
Uploads also send a SHA-256 transport checksum. ETags are not used as hashes. No migration was needed: Milestone 4's completion
command already owns immutable artifact/provenance metadata and job completion.

The owner can download an available artifact from Product revision detail. The route
accepts only an artifact ID, authorizes through the authenticated owner and RLS,
checks canonical identity and configured bucket, and signs the exact stored version.
Expiry defaults to 60 seconds and is limited to 300 seconds. Unauthorized, missing
and malformed IDs share 404 behavior. Errors and redirect caching are controlled;
secrets and bucket/key input are never accepted from client code.

Local MinIO setup preserves private versioning and now provisions distinct runtime
credentials without deletion or administration permissions. Pinned images use the
working Quay registry. Production requires private S3, Block Public Access,
versioning, restricted IAM and conditional-write bucket policy; this is not a live
AWS deployment or production-security audit.

Acceptance creates deterministic fixture bytes independently of any durable worker.
It uses real MinIO and the existing database commands under `atelier_worker`, with
local administrative access only for fixture setup/role assumption. Corruption and
size failure injection tests verify that real Postgres metadata stays absent. No
Trigger.dev execution or fake production generation was introduced.

## Validation

Validation completed for Milestone 7:

- Clean local database reset and full pgTAP: **195/195** (22 new storage assertions).
- Full Playwright: **21/21** against real local Supabase and MinIO: nine auth,
  six Products and six storage cases, including a separate cross-account owner.
- Repository **19/19**, unit **129/129** (including **32 adapter** tests), workspace **17/17**.
- Real MinIO integration **6/6**: private verified bytes, exact versions, sequential
  overwrite rejection, concurrent first-writer exclusion, denied version/delete-marker
  deletion, and signed capability expiration. Final storage browser rerun **6/6** also
  exercises clicking the actual download link.
- Coverage gate: **98.90% lines, 97.84% branches, 96.29% functions, 98.62% statements**
  in the configured Vitest scope including the adapter/download service; repository
  and workspace coverage gates pass.
- Typecheck, lint, configured production build, architecture guardrails and
  `git diff --check` pass. Production dependency audit: **zero vulnerabilities**.
- Build uses local configuration; this is not a live AWS production test. Browser
  bundle scan finds no configured runtime secrets. Security/correctness review found
  no blocking authorization, immutability or provenance issues.

## Known limitations and next scope

Storage and Postgres cannot commit atomically. A failed verification or database
completion may leave a private unreferenced object; it cannot create available
metadata through this upload path. Uncertain writes are not automatically retried,
and even identical-byte repeated puts to an existing key fail closed. The existing
SQL completion command retains exact-metadata replay semantics. Later recovery must
preserve immutable identity; no object cleanup/reconciliation workflow is added.

Issued signed URLs are bearer capabilities until expiration; logout or membership
changes do not revoke an already-issued URL. Do not log or persist capabilities.
Runtime deletion and lifecycle deletion of artifact identities must stay disabled:
S3 conditional writes check the current version, and delete markers could permit
key reuse. Object Lock and stronger recovery governance remain deferred.

Milestone 6's separate replayed product-creation requests can still create distinct
products. Pending duplicates are blocked and uncertain writes are not retried. This
behavior was not redesigned.

Real MinIO concurrency testing exposed a stale keep-alive socket reset following a
conditional-write rejection. The adapter uses fresh connections with one attempt,
preserving no-retry semantics. This trades TCP/TLS connection reuse for predictable
Phase 1 behavior; it does not weaken overwrite or integrity guarantees.

Milestone 7 completes only private artifact storage and authorized downloads. The
**next recommended slice is Milestone 8: real Trigger.dev Cloud v4 durable workflow/
dispatcher and Phase 1 test-build execution**, followed by browser-close/redeploy
acceptance. Do not treat those capabilities as implemented. Do not begin Phase 2 or
the later Product Workspace. Production provider setup/live durability remain
unverified. CI runs static/unit/coverage/build checks but does not provision local
Supabase/MinIO or run pgTAP/browser acceptance.

Operational details and commands are in [Local development](LOCAL_DEVELOPMENT.md#milestone-7-private-artifact-storage).

## Resume safely

1. Inspect branch, `git status`, tracked diff, untracked files and recent commits first. Preserve valid uncommitted work; do not reset, clean, stash or overwrite it.
2. Read this status, linked docs, applicable instructions, tests and contracts. Resolve scope from repository evidence, distinguishing milestones from phases.
3. Work within the requested milestone. Persist coherent changes incrementally; validate and commit separate completed steps when authorized.
4. Do not silently redesign approved boundaries: no fixed aesthetic/template catalog, legacy import, mutable revision history, browser-owned durable jobs, separate preview/final lineage, arbitrary Etsy payloads or automated Etsy publication. Approval must bind exact bytes and listing metadata.
