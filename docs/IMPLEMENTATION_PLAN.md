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
- authenticated private app
- DB schema/migrations
- object storage
- project/product/revision records
- audit events
- durable jobs + progress UI
- secrets strategy

Exit: create a product project, persist a revision, enqueue/resume a dummy durable workflow, survive browser closure.

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
