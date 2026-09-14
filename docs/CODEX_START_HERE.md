# Codex Start Here

Read, in order:
1. `README.md`
2. `docs/PRD.md`
3. `docs/ARCHITECTURE.md`
4. `docs/IMPLEMENTATION_PLAN.md`
5. `docs/adr/0001-greenfield-not-migration.md`
6. `docs/adr/0002-no-etsy-publish.md`
7. `packages/contracts/src/index.ts`
8. `packages/core/src/index.ts`

Before implementation, inspect the repo and propose the smallest Phase 1 plan consistent with these documents. Do not import the legacy repository or recreate families/profiles/templates as the creative architecture.

Hard prohibitions:
- no automated Etsy publish capability;
- no arbitrary Etsy payload API;
- no fixed aesthetic/theme catalog as the AI designer;
- no filesystem directories as the source-of-truth database;
- no long-running generation tied to one browser request;
- no preview path separate from final render lineage.
