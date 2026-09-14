# Greenfield Implementation Plan

## Phase 0 — Foundation (this repository state)
- monorepo and web shell
- authoritative PRD/architecture
- domain contracts
- explicit state machine
- AI role prompts
- Etsy draft-only port interface
- CI/security baseline

Exit: repository can build/typecheck and architecture tests prohibit legacy template-catalog + Etsy publish capabilities.

## Phase 1 — Persistence, auth, projects, durable jobs
- record the Phase 1 provider and security decisions in ADRs;
- add local Supabase Postgres, MinIO, and Trigger.dev development contracts;
- define Zod contracts and provider-neutral repositories, object storage, workflow, and secret ports;
- add forward-only SQL migrations for users, accounts, memberships, products, immutable revisions, artifacts/lineage, jobs/attempts/events, workflow bindings/outbox, and audit events;
- enable row-level security around account membership and least-privilege worker functions;
- implement invite-only Supabase magic-link authentication with no public signup or MFA UI;
- implement the single-owner Products flow and immutable revision 1 creation;
- implement private S3 / local MinIO writes using server-generated keys, SHA-256 verification, conditional no-overwrite, versioning, and short-lived authorized downloads;
- implement a Trigger.dev Cloud v4 dummy workflow that persists progress independently of the browser and Vercel deployment;
- add structured observability, integration tests, pgTAP security tests, Playwright coverage, and CI gates.

Exit acceptance flow:

1. Authenticate as the invited owner.
2. Create and open a product named `Soft Discipline`; observe immutable Revision 1.
3. Select `Run Test Build`; observe persisted job progress.
4. Close the browser completely while the durable worker continues.
5. Return after browser closure or a Studio restart/redeploy and observe the same completed job.
6. Download the immutable dummy artifact through an authorized short-lived URL.
7. Confirm product, revision, job, events, artifact metadata, SHA-256 provenance, and object bytes remain durable.

Do not begin Phase 2 while implementing Phase 1. The test-build action is infrastructure validation, not a product generator, and it must not add product templates, families, themes, design profiles, or other fixed creative catalogs.

## Phase 2 — Creative Director + structured product planning
- conversation persistence
- inspiration link/upload intake
- Product Brief structured output
- ProductSpec generation/validation/repair
- Visual DNA
- page manifest with stable IDs

Exit: conversational idea → valid inspectable ProductSpec without any hard-coded product/aesthetic catalog.

## Phase 3 — Generative design + deterministic renderer
- layout primitive schema expansion
- design specification generation
- asset generation pipeline
- renderer
- per-page PNG + PDF outputs
- initial print/digital format support

Exit: one concept produces a coherent multi-page real deliverable from the same design spec shown in review.

## Phase 4 — Visual QA + repair graph
- render inspection
- machine-readable findings
- asset/page dependency graph
- targeted repair/regeneration
- visual regression fixtures

Exit: a deliberately broken page is repaired without rebuilding unrelated pages.

## Phase 5 — Product workspace + conversational editing
- page grid/fullscreen
- files/QA/history tabs
- target resolution from user edit request
- immutable revision creation
- selective re-render
- revision compare/restore

Exit: user can change one page/asset through natural language and retain prior versions.

## Phase 6 — Listing Studio
- listing strategy from verified product facts
- 10-image communication plan
- actual-page compositing into scenes/mockups
- title/description/tags/category/price recommendation
- marketplace factual-consistency QA

Exit: finished product has reviewable listing package with no hallucinated product features.

## Phase 7 — Release sealing + Etsy drafts
- capability snapshot
- OAuth and encrypted token storage
- exact-byte preflight
- immutable approval + release seal
- idempotent draft workflow
- image/file upload
- uncertain-write reconciliation
- remote read-back comparison
- receipt + Etsy link

Exit: mocked E2E and controlled live validation create verified drafts only; no publish route exists.

## Phase 8 — Brand Library + autonomy scaling
- save liked design principles/assets
- product ideation based on brand preferences
- batch/multiple-product jobs
- cost controls/model tiering
- optional notifications

Exit: multiple independent products can move through the factory while preserving review/release safety.
