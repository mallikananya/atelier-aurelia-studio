# Implementation status and handoff

Snapshot: 2026-09-17. Milestones 1–5 are complete; do not treat the remaining Phase 1 acceptance flow as implemented. This document records repository evidence and resume boundaries. Product requirements and architecture remain authoritative in [PRD](PRD.md), [Architecture](ARCHITECTURE.md), [Implementation plan](IMPLEMENTATION_PLAN.md), and [ADR 0003](adr/0003-phase-1-platform.md).

## Intended product and approved architecture

Atelier Aurelia is a private AI-native studio: idea → finished digital product → review and targeted conversational edits → exact release approval → verified Etsy draft. Publication is manual in Etsy. AI owns creative direction and artwork; deterministic services own validation, rendering, packaging, QA, provenance, approval, and marketplace submission.

Approved platform: Next.js on Vercel; invite-only Supabase Auth and Postgres; private AWS S3 with local MinIO; Trigger.dev Cloud v4 for durable execution outside browser/Vercel request lifetimes. These are architecture decisions, not claims that all adapters are operational.

Domain boundaries:

- `apps/studio`: presentation and authenticated application routes.
- `packages/contracts`: versioned Zod contracts, provider-neutral records and ports.
- `packages/core`: state transitions, orchestration and release semantics.
- `packages/ai`: AI roles and structured generation boundaries.
- `packages/storage`: repository/object-storage boundaries; concrete storage work remains ahead.
- `packages/etsy`: closed draft-only marketplace boundary.
- `supabase`: durable schema, transactional commands, RLS and private worker functions.

## Completed milestones

The first three labels below summarize the corresponding commits; the repository explicitly names Milestones 4 and 5 in [Local development](LOCAL_DEVELOPMENT.md). Milestones are slices of Phase 1, not the numbered product phases in the implementation plan.

| Milestone | Status and evidence |
| --- | --- |
| 1 — Platform architecture | Complete: `39df399`, accepted ADR 0003 and Phase 1 architecture. |
| 2 — Local service tooling | Complete: `38fed28`, Supabase/MinIO configuration, environment contract and validation scripts. |
| 3 — Domain contracts | Complete: `9d3bf8f`, Phase 1 Zod contracts, state machine and provider-neutral ports. |
| 4 — Database persistence | Complete: `2893e83`, three initial migrations, 13 tables, transactional commands, RLS, worker APIs and pgTAP. |
| 5 — Invite-only authentication | Complete: `78872bf`, server sessions, protected routes, magic-link confirmation, logout, unit and browser tests. |

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

## Validation and current repository state

At this handoff, implementation and regression commits above were pushed to `origin/main` and verified equal to local `main`. This document is delivered in its own documentation-only commit; obtain its hash with `git log -1 -- docs/IMPLEMENTATION_STATUS.md`. Recheck live status rather than assuming this snapshot stays current.

Validation performed for the reliability follow-up:

- Clean local `npm run db:reset`; full pgTAP **136/136**.
- `npm test`: 18 root repository tests, 35 unit tests, 17 workspace tests passed.
- Type checking, lint, architecture guardrails and `git diff --check` passed.
- Production build passed with explicit public auth configuration using a build-only placeholder key. A build without required auth environment variables fails; this checkout has no `.env`.
- `npm audit --omit=dev`: zero vulnerabilities.

Milestone 5 has nine auth browser cases in `tests/e2e/auth.spec.ts`; its prior full validation was supplied at handoff, and those browser cases were not rerun for this SQL-test-only follow-up. Do not describe a placeholder-config build as a live authentication test.

For future changes, run relevant unit/integration tests and critical-flow Playwright tests. Database changes require clean reset plus full pgTAP, including RLS and replay behavior. Run typecheck, lint, build, guardrails, production dependency audit and diff checks before release. `npm run test:coverage` enforces 80% coverage gates. Local database reset is destructive to development data; pgTAP fixtures themselves roll back.

## Deferred work and next scope

The repository does not explicitly number a “Milestone 6.” The next Phase 1 item after authentication in [Implementation plan](IMPLEMENTATION_PLAN.md#phase-1--persistence-auth-projects-durable-jobs) is the **single-owner Products flow and immutable revision 1 creation**, consistent with the product-UI boundary in Local development. Treat that as the next slice to scope, not permission to implement all remaining Phase 1 work. The current Products page still displays examples rather than persisted products. **No Milestone 6 work was started.** Phase 6 in the broader plan means Listing Studio and is unrelated to this next slice.

Object-storage adapters, the real Trigger.dev worker/dispatcher, persisted product UI, authorized downloads and the browser-close/redeploy durability acceptance flow remain ahead. CI currently runs static/unit/coverage/build guardrails but does not provision services or run pgTAP/auth E2E. Production provider setup and live durability are not verified by this handoff. README's Phase 0 status and Local development's pre-implementation Milestone 5 approval sentence are historical; use this status snapshot for completion state.

Deferred by ADR: MFA UI, team/workspace administration, account-scoped secrets/KMS, Object Lock, cross-region replication and advanced recovery automation. Do not add these speculatively.

## Resume safely

1. Inspect branch, `git status`, tracked diff, untracked files and recent commits first. Preserve valid uncommitted work; do not reset, clean, stash or overwrite it.
2. Read this status, linked docs, applicable instructions, tests and contracts. Resolve scope from repository evidence, distinguishing milestones from phases.
3. Work within the requested milestone. Persist coherent changes incrementally; validate and commit separate completed steps when authorized.
4. Do not silently redesign approved boundaries: no fixed aesthetic/template catalog, legacy import, mutable revision history, browser-owned durable jobs, separate preview/final lineage, arbitrary Etsy payloads or automated Etsy publication. Approval must bind exact bytes and listing metadata.
