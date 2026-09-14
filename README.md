# Atelier Aurelia Studio

Atelier Aurelia Studio is a private AI-native digital product studio that turns a creative idea into a finished, reviewable Etsy digital product and verified Etsy draft.

## Product principle

**Do not code aesthetics. Code the factory.**

AI owns creative direction, product architecture, visual direction, and generative artwork. Deterministic services own schemas, rendering, packaging, QA, versioning, approval, storage, and Etsy draft submission.

## End-user workflow

1. Brainstorm a product in the Studio.
2. Add optional inspiration links/images.
3. Approve the concept by clicking **Build Product**.
4. The factory generates the product autonomously.
5. Review pages, files, listing images, copy, and QA.
6. Request targeted conversational edits without rebuilding unrelated work.
7. Approve an exact release.
8. Send the sealed release to **Etsy Drafts**.
9. Publish manually inside Etsy.

There is intentionally **no automated Etsy publish capability**.

## Repository layout

- `apps/studio` — private web application and review/edit UI.
- `packages/contracts` — versioned domain-neutral schemas/contracts.
- `packages/core` — state-machine and orchestration domain logic.
- `packages/ai` — AI role definitions/prompts and structured-output boundaries.
- `packages/storage` — storage interfaces; provider implementation comes later.
- `packages/etsy` — Etsy adapter boundary; draft-only.
- `docs/PRD.md` — authoritative product requirements.
- `docs/ARCHITECTURE.md` — technical architecture and invariants.
- `docs/IMPLEMENTATION_PLAN.md` — phased build order for Codex.

## Guardrails

- No legacy planner/template/family/profile architecture.
- No arbitrary Etsy payloads.
- No live Etsy publish endpoint, button, queue action, or worker task.
- Previewed assets and released assets share one provenance chain.
- Every generated page/asset/revision is addressable and versioned.
- Approval binds to exact artifact bytes + exact listing metadata.

## Status

Greenfield foundation. Phase 0 establishes architecture, contracts, Studio shell, tests, and CI before external side effects are enabled.
