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
