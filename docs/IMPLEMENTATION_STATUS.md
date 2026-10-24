# Implementation status and handoff

Snapshot: 2026-09-21. Milestones 1–7 are complete; Milestone 8 repository implementation and local acceptance are complete, with Cloud provisioning/live acceptance pending; do not treat the remaining Phase 1 acceptance flow as implemented. This document records repository evidence and resume boundaries. Product requirements and architecture remain authoritative in [PRD](PRD.md), [Architecture](ARCHITECTURE.md), [Implementation plan](IMPLEMENTATION_PLAN.md), and [ADR 0003](adr/0003-phase-1-platform.md).

## Step 1 cloud-readiness follow-up — 2026-10-22

Repository preparation is complete and locally validated. **Remote staging and full
Step 1 acceptance remain incomplete; Step 2 has not begun.** Existing migrations,
MinIO acceptance and durable-execution guarantees are preserved.

| Deliverable | Current evidence / next gate |
| --- | --- |
| Supabase staging target | Existing `atelier-aurelia-studio-staging`, reference `wasnnohlwphngcvpicbf`, resumed on the existing Free plan after explicit user authorization; spend cap retained. Public signup disabled; anonymous sign-in off, email confirmation on, Email provider enabled. |
| Supabase preparation | [Staging runbook](SUPABASE_STAGING.md), password-free NOLOGIN provisioning and read-only privilege verifier ready. Local baseline plus ten unsafe-privilege rejection/rollback cases passed. Worker URL validation rejects pooled administrative usernames and known transaction-pooler endpoints. |
| Remote migrations/Auth/worker | Netlify staging Site URL and the exact HTTPS `/auth/confirm` redirect are configured. **Pending:** CLI login by owner, apply four forward migrations (dashboard currently shows no tracked migrations), templates, invite intended owner first, verify RLS, activate restricted credential manually, verify remote TLS/session access. Dashboard now requires custom SMTP or Pro for template edits; no upgrade authorized. Existing free SMTP credentials must be configured privately. |
| Trigger Cloud | Existing project `proj_fielriwlwflsqochecli` verified. User authorized existing Free Production exclusively for isolated preproduction. CLI authentication and explicit preproduction dry-run pass; runtime pinned to Node 24 after deprecated Node 21 warning. Before deployment, dashboard showed no tasks/runs or Production-scoped custom credentials; October usage was $0/$5. Only the non-secret project reference was subsequently added. Credential-free bounded smoke and manual schedule opt-in prepared. Deployment `20261022.2` (`ebrog7rn`, code commit `0951a06`) succeeded. Smoke `run_06gmbmpdgbv8vmnechsib8nka2` completed once with `{status: ok, scope: cloud-runtime-only}`; zero schedules attached and all task running counts zero. Initial deployment failed safely on missing remote non-secret project reference; configured that value and retried successfully. Development smoke `run_06gmbn72hnrjfr9le32fees4a2` also completed with the expected output; local worker stopped afterward. |
| Staging web host | Vercel has no Atelier project or deployment; its Hobby terms prohibit this commercial application. Netlify Free project `atelier-aurelia-studio-staging` published deployment `6adcd8352b5c0a1ce7b49e0c` from commit `504f03f` on October 24. The site is private, uses only three browser-safe staging variables, renders the invite-only login, and redirects anonymous `/products` access to login. Production hosting remains the existing Vercel architecture decision. |
| AWS artifacts | [Policy artifacts and dedicated acceptance suite](../infra/aws/README.md) ready, including separate worker, download signer and audit identities. Five offline tests pass; explicit target/credential guard prevents accidental execution. |
| AWS live acceptance | **Pending — support ticket blocks provisioning.** No AWS requests or resources created. Bucket controls, effective IAM and all real AWS storage/signer checks remain unverified. |
| Cloud durability | **Pending:** actual staged job survives browser close/web redeploy, retries/cancellation, persisted exact-version bytes and authorized downloads. Hold actual build execution and dispatcher/reconciler schedules while AWS prerequisites are unmet; isolated credential-free runtime smoke is separate acceptance. |

Local validation evidence (distinguish prior clean regression from current reruns):

- Prior clean local reset and pgTAP: **218/218**. No remote reset performed.
- Repository/offline checks: **24/24**; unit tests: **199/199** (October 22 rerun); workspace tests: **17/17**.
- Prior clean real-service browser suite: **22/22**. Latest repeat stopped on the
  existing multiple-owner fixture safety guard (7 passed, 2 failed, 13 not run);
  local reset awaits explicit user approval after automatic review rejection.
- Current durable workflow integration: **7/7**; real MinIO integration: **6/6**.
  Vitest and coverage patched to **5.0.3**; all 199 unit tests and coverage gates pass.
  Production build rerun passes; browser tests have not been weakened.
- Coverage gates (80% minimum), typecheck, lint, architecture guardrails and production build pass.
- Local setup initially lacked credentials; the successful run loaded existing local
  service credentials privately in process memory. No tests were weakened or skipped.
- Security audit remediation updated compatible locked dependencies, including Next.js
  16.4.2. Production audit: **zero vulnerabilities**. Full audit retains **five high
  development-tool findings** in the unpatched braces → micromatch → fast-glob → Next
  ESLint dependency chain. The suggested incompatible downgrade was not applied.
  This is an open development-tool risk, not a clean full audit.

Validated milestone commits: `582a28e` (compatible security updates), `3d6016f`
(Supabase staging preparation), `3bf45c5` (Trigger/Vercel preparation), and
`d816753` (AWS policy artifacts and acceptance), `68007e4` (Vitest security patch),
and `0951a06` (isolated Trigger acceptance). Trigger deployment is verified above;
all validated milestones are prepared for push to the existing `origin/main`.

Completion checklist:

- [x] AWS-independent repository artifacts and restricted connection checks.
- [x] Dedicated AWS suite with existing storage guarantees and separate signer checks.
- [x] Prior clean local regression and compatible dependency remediation.
- [ ] Latest clean browser regression rerun, pending approved local fixture reset.
- [x] Resume existing Supabase Free project and disable public/anonymous signup.
- [ ] Remote Supabase migrations, SMTP/templates, Auth acceptance and restricted worker access.
- [x] Trigger Free preproduction authorization, authenticated dry-run and bounded smoke preparation.
- [x] Trigger hosted credential-free smoke; no active schedules or workers left running.
- [ ] Restricted runtime secrets and full AWS-backed durability acceptance.
- [x] Netlify Free staging project/environment configuration and anonymous Auth/Products guard checks.
- [ ] Invited-owner magic-link login and authenticated Products smoke after remote migrations/templates.
- [ ] AWS-dependent acceptance and final Cloud durability flow.
- [ ] Resolve remaining development-only audit findings when a compatible fix exists.

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

## Milestone 8 — durable execution repository delivery

Started from verified clean `main` at `d36ba5e50057cd7067dd43311b063170f1ec487d`.
The user confirmed no Trigger.dev Cloud project exists yet. Repository implementation
and local validation are complete; **Cloud provisioning, deployment and live durability
acceptance remain blocked on interactive account/project setup**. Do not mark the
entire milestone deployed or begin the next milestone.

- Separate `packages/workflows` server workspace pins Trigger.dev SDK 4.6.3 and
  provides real build, scheduled dispatch and scheduled reconciliation tasks.
- Authenticated Product detail enqueues via the existing database command, with one
  stable job per revision through this proof-build UI. PostgreSQL derives ownership;
  no browser provider credentials, run IDs or completion assertions are accepted.
- Existing leased outbox, run bindings, attempts, immutable revision and completion
  commands remain authoritative. Global provider idempotency reduces duplicates;
  exact database run binding prevents an unbound/replayed provider run from executing.
- New private execution fences support interrupted-attempt resumption and reject
  stale attempts. A dedicated least-privilege PostgreSQL login uses parameterized
  worker functions and a session advisory lock across execution. Direct/session
  connections are required; transaction pooling is unsupported.
- Bounded proof bytes derive from the persisted revision. Existing verified storage
  upload and completion boundaries persist the exact object version and digest.
  Each invocation gets a new artifact identity; uncertain writes may remain private
  orphans but never overwrite prior objects. Completed replays perform no upload.
- Three bounded provider attempts, cancellation signal checks, terminal hooks and a
  five-minute reconciliation schedule cover retries, cancellation and missing hooks.
  Provider success never substitutes for verified database completion. Structured
  logs contain job/run/attempt identifiers, not secrets or artifact capabilities.

Milestone 7 production storage/download files are unchanged. Its acceptance fixture
now uses a static import to avoid a Playwright CommonJS/ESM cache conflict introduced
by loading both storage and workflow acceptance in the same suite.

Validation of the final repository implementation:

| Check | Result |
| --- | --- |
| Clean local migration reset + pgTAP | **218/218**, including 23 durable-execution assertions |
| Repository tests | **19/19** |
| Unit tests | **195/195** |
| Workspace tests | **17/17** |
| Full real-service Playwright | **22/22** |
| Real PostgreSQL/MinIO workflow integration | **7/7** |
| Existing real MinIO integration | **6/6** |
| Coverage | **98.21% lines, 97.68% branches, 93.44% functions, 97.51% statements**; all gates pass |
| Typecheck, lint, production build, guardrails, diff whitespace | Pass |
| Full + production dependency audits | **0 vulnerabilities** |
| Secret checks | Source secret-pattern scan and configured storage-secret browser-bundle scan pass |
| Separate correctness/security review | No blocking findings after cancellation fix; regression test verified RED then GREEN |

Real workflow integration covers duplicate dispatch/execution, nonexistent jobs and
wrong runs, actual storage failure and retry, interrupted worker retry, concurrent
session exclusion, and injected database completion failures both before and after
an actual commit. Existing SQL/UI tests retain invalid revisions, stale states and
cross-account authorization coverage. The provider transport is a local substitute
in these integration tests; PostgreSQL, worker permissions, MinIO and completion
transactions are real.

Remaining limitations: no live Trigger project/token, deployment or browser-close/
web-redeploy Cloud evidence yet; no orphan cleanup; no user-facing cancellation or
terminal-job retry UI; permanent invalid runs may consume bounded provider retries
before terminal rejection. Provider status outages are logged and retried by later
reconciliation, never treated as proof of success. CLI deployment tooling is fetched
on demand and is outside the audited runtime tree. The patched `ws` override removes
a vulnerable SDK transitive dependency from that tree.

Follow [Milestone 8 setup](LOCAL_DEVELOPMENT.md#milestone-8--durable-phase-1-execution).
The remaining user action is to create a Trigger Cloud organization/project, return
its non-secret `proj_...` reference, authenticate the CLI, and configure environment
secrets privately. Cloud workers require reachable staging PostgreSQL and private S3;
they cannot connect to localhost services. Then deploy, verify schedules and run the
live persisted-job acceptance before declaring all of Milestone 8 complete.

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

Milestone 7 completes only private artifact storage and authorized downloads. Milestone 8 repository implementation now provides the durable workflow/dispatcher
and Phase 1 test build described above. Its Cloud provisioning and browser-close/
redeploy acceptance remain pending. Do not begin Phase 2 or
the later Product Workspace. Production provider setup/live durability remain
unverified. CI runs static/unit/coverage/build checks but does not provision local
Supabase/MinIO or run pgTAP/browser acceptance.

Operational details and commands are in [Local development](LOCAL_DEVELOPMENT.md#milestone-7-private-artifact-storage).

## Resume safely

1. Inspect branch, `git status`, tracked diff, untracked files and recent commits first. Preserve valid uncommitted work; do not reset, clean, stash or overwrite it.
2. Read this status, linked docs, applicable instructions, tests and contracts. Resolve scope from repository evidence, distinguishing milestones from phases.
3. Work within the requested milestone. Persist coherent changes incrementally; validate and commit separate completed steps when authorized.
4. Do not silently redesign approved boundaries: no fixed aesthetic/template catalog, legacy import, mutable revision history, browser-owned durable jobs, separate preview/final lineage, arbitrary Etsy payloads or automated Etsy publication. Approval must bind exact bytes and listing metadata.
