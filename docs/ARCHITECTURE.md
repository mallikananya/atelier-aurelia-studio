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

## Initial deployment direction

- Vercel: Studio web app.
- Postgres-compatible managed DB: durable state.
- S3-compatible object storage: immutable binaries.
- Durable workflow/job provider: selected during Phase 1 ADR based on execution/runtime requirements.

Provider selection is intentionally deferred until the contract boundary and workload requirements are implemented; do not let a vendor SDK become the domain model.
