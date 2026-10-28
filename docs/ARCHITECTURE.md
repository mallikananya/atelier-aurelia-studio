# Architecture

## System shape

```text
User
  │
  ▼
Next.js Studio
  │
  ├── conversational creative API
  ├── product/revision review UI
  ├── signed artifact access
  └── explicit approval / Etsy-draft actions
  │
  ▼
Application Services
  ├── Creative Orchestrator
  ├── Revision Graph
  ├── Job/Workflow Engine
  ├── Renderer
  ├── QA Engine
  ├── Packaging Service
  └── Marketplace Adapter
  │
  ├──────────► OpenAI text/image models
  ├──────────► Postgres-compatible DB
  ├──────────► Object storage
  └──────────► Etsy API (draft-only)
```

## Architectural invariants

1. Product type and aesthetic are data, not enum-driven creative catalogs.
2. AI output crosses deterministic boundaries only through versioned schemas.
3. Preview and final output share the same render lineage.
4. Each page/asset is addressable.
5. All revisions are immutable; current is a pointer, not an overwrite.
6. Long-running generation is durable and resumable.
7. Approval seals exact artifact + metadata state.
8. Marketplace payloads are derived from sealed state, never passed arbitrarily.
9. Etsy writes are idempotent and reconciled after uncertainty.
10. Etsy publish does not exist.

## Monorepo boundaries

- `apps/studio`: presentation + authenticated application routes.
- `packages/contracts`: Zod/versioned wire + persistence contracts. No provider logic.
- `packages/core`: domain transitions, dependency graph, release semantics.
- `packages/ai`: provider-agnostic role orchestration and structured generation.
- `packages/storage`: repository/blob abstractions and implementations.
- `packages/etsy`: marketplace adapter only.

## Phase 1 deployment architecture

Local development uses the same application and domain boundaries with Supabase CLI
PostgreSQL/Auth/Mailpit, MinIO through the S3 adapter, and the local workflow runner.
Trigger.dev Cloud, hosted Supabase, AWS S3, and production SMTP are optional deployment
adapters and are not required for local execution.

```text
Browser
  │ magic-link session
  ▼
Next.js Studio on Vercel
  ├── Server Components / Server Actions ──► Supabase Auth + Postgres
  ├── authorized signed-download route ─────► S3 adapter ──► private AWS S3
  └── enqueue transaction ──────────────────► jobs + workflow_outbox
                                                     │
                                                     ▼
                                         Trigger.dev Cloud v4 task
                                                     │
                          ┌──────────────────────────┼──────────────────────────┐
                          ▼                          ▼                          ▼
                    Postgres job state        S3 artifact bytes         audit/job events
```

- Vercel hosts the authenticated Studio and short request/response work only.
- Supabase Auth provides invite-only magic links. Supabase Postgres is the runtime source of truth.
- AWS S3 holds immutable artifact bytes. MinIO implements the same adapter locally.
- Trigger.dev Cloud v4 executes durable work outside the browser and Vercel request lifecycle.
- Zod validates every application and provider boundary.
- Provider SDKs are confined to adapters; provider identifiers live in binding records rather than domain entities.

The current experience is deliberately single-owner. Accounts, memberships, and row-level security preserve a future multi-user boundary without exposing team, organization, role, invitation, or workspace-switching UI.

## Phase 1 request and workflow flow

1. An invited owner authenticates with a magic link. The Studio exchanges the link for a server-readable Supabase session.
2. A Server Action validates input, relies on row-level security, and creates a product plus immutable revision 1 in one database transaction.
3. `Run Test Build` atomically creates a stable job and an outbox message. The HTTP request returns after durable enqueue state exists.
4. A dispatcher delivers the outbox message to the Trigger.dev adapter using the stable job ID as the idempotency key.
5. The Trigger.dev task records attempts and progress events, creates deterministic dummy bytes, writes them once through the object-storage port, verifies SHA-256 provenance, and commits artifact metadata plus lineage.
6. The product page reads persisted status from Postgres. Browser closure or a Studio redeploy cannot terminate or erase the workflow.
7. An authorized download handler verifies account access, issues a short-lived signed S3 URL, and redirects the owner to the immutable object.

## Phase 1 data and storage invariants

- `products.current_revision_id` is a pointer; revisions are append-only and never updated in place.
- Product type remains free-form revision data. No product family, theme, design profile, or template registry exists.
- Jobs, attempts, progress events, audit events, artifacts, and lineage records have stable UUIDs.
- Database rows are authoritative for identity, status, ownership, provenance, and lineage. Object listings are never used to reconstruct application state.
- Artifact keys are server-generated from stable IDs, not filenames or user input.
- Artifact bytes are write-once. Upload uses a conditional no-overwrite request and SHA-256 verification.
- Preview and final artifacts will attach to the same lineage graph; Phase 1 creates only a dummy test artifact.
- Marketplace integration remains outside Phase 1 and Etsy publish remains prohibited everywhere.

## Phase 1 secrets and recovery

Phase 1 platform credentials live only in Vercel, Trigger.dev, GitHub, Supabase, AWS, or local environment secret stores. They are never returned to browser code or written to application tables. A provider-neutral `SecretStore` port may define the later boundary, but AWS KMS and account-secret persistence are deferred until account-scoped credentials exist.

Phase 1 recovery uses Supabase managed backups and S3 versioning. A future operations milestone should enable the appropriate Postgres point-in-time recovery tier, scheduled logical exports, restore drills, and—if the risk profile requires it—cross-region object replication. Those mechanisms are documented, not implemented speculatively now.

## CE-01 — Creative planning foundation

`packages/contracts/src/planning.ts` is the versioned planning entry point;
`packages/ai/src/planning.ts` provides `planProduct(provider, request)`. These are
standalone domain/service modules, not yet connected to Studio, persistence or a
live provider. Existing ProductSpec, PageSpec, VisualDNA, revision and artifact
contracts remain unchanged. The fixed planner is not used by this service.

The contracts are:

| Contract | Version | Purpose |
| --- | --- | --- |
| CreativeBriefV1 | `creative-brief/1` | Customer, job-to-be-done, concept, differentiation, visual direction, risks and assumptions |
| PageManifestV1 | `page-manifest/1` | Ordered, stable-ID pages with purpose/density, page dependencies and source references; no elements or geometry |
| DeliverablePlanV1 | `deliverable-plan/1` | Named PDF/PNG output intentions, print/digital/preview usage, descriptive page size and ordered page references |
| CreativePlanV1 | `creative-plan/1` | Provider-generated brief, VisualDNA, manifest and deliverable plan |
| PlanningProvenanceV1 | `planning-provenance/1` | Idea, input hash, source provenance, generator/prompt versions, timestamp, attempts and retained page IDs |
| PlanningEnvelopeV1 | `planning-envelope/1` | Validated plan and provenance bound to caller-supplied product/revision/parent identity |

The manifest derives its vocabulary from PageSpec while excluding `elements`.
Planning VisualDNA refines the existing schema with bounded nonempty text and a
nonempty palette; it remains creative intent, not resolved fonts or render styles.
Source records reuse InspirationRef. Strict objects reject undeclared fields,
including expanded geometry and model-authored revision metadata. Supported output
formats describe technical capabilities, not a product or aesthetic catalog.

`StructuredPlanningProvider.generate` receives the idea, source references,
retained page IDs, expected plan version, attempt number and bounded validation
feedback. It returns JSON text. Adapters own transport timeouts/cancellation;
CE-01 bounds total calls, not elapsed time. No SDK, network call, persistence or
model selection is implemented. Generator and prompt metadata are supplied by the
trusted caller and must describe the injected adapter accurately.

The service allows at most **three total calls** (initial generation plus two
repairs). Invalid JSON, schema failures, broken references and excessive output
consume that fixed budget. Repairs receive the previous bounded response and
path/code diagnostics; semantic errors include fixed schema-authored messages.
Oversized/non-text output is not echoed back. Provider exceptions return a
sanitized `provider_failure` immediately, without transport retries. Invalid input
returns `invalid_input` with zero attempts; exhaustion returns `invalid_output`.
Errors contain at most 20 issues and redact dynamic palette keys. The result is a
discriminated success/error union, never an implicitly accepted partial plan.

Validation enforces unique node IDs, contiguous manifest order starting at one,
page-count consistency, acyclic known page dependencies, unique known source
references, ordered deliverable references, and coverage of every page by an
output. Limits are 200 pages, 20 deliverables, 20 sources and 2,000 characters per
prose field. These are bounded CE-01 capabilities, not universal product limits.
All versions must match exactly. Revision 1 has no parent; later revisions require
a different parent ID. Database authorization, parent existence and cross-product
lineage checks remain the persistence boundary's responsibility.

Caller-supplied `retainedPageIds` must survive generation. This protects explicitly
retained identities, but does not infer edit targets or prove semantic continuity.
Future revision orchestration must supply those constraints from authoritative
prior state. Dependencies currently describe page-to-page and page-to-source
relationships; asset/render/QA dependency graphs remain later work.

The entire envelope is intended to be revision `content`, not nested within extra
metadata. The existing SQL append command records its outer persistence version
as `phase1.1`; the content carries its own `planning-envelope/1` version. The service
does not invoke that command or change the database. Input is limited to 16 KiB,
raw provider output to 64 KiB, and the complete validated envelope to 65,536 bytes
of PostgreSQL-style JSONB text, including UTF-8 and separator spaces. Numeric fields
are bounded integers, avoiding exponent-expansion ambiguity. NUL and unpaired
surrogates are rejected. Additional wrappers require their own total-size check.
The byte estimator is not a content-hash algorithm: database JSONB hashing remains
authoritative. `inputSha256` hashes the normalized JSON representation of idea,
sources and retained IDs; prompt/generator versions are recorded separately.

Acceptance fixtures in `packages/ai/src/fixtures/planning.ts` exercise contrasting
French romantic reading and bold retro travel concepts through the same service.
They are test data, not production defaults or selectable presets. No original
artwork, rendered design, persisted conversation, approval or Etsy behavior is
claimed. Follow-on work must preserve immutable revision/asset lineage, selective
repair identities, same-lineage preview/export and exact commercial release seals.
