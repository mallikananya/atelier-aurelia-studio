# ADR 0003: Phase 1 managed platform and durability boundaries

Status: Accepted

## Context

Phase 1 must deliver a private, single-owner Studio whose durable jobs survive browser closure and application redeployment. It must remain simple today while preserving explicit provider boundaries and future account-level authorization.

## Decision

- Host the Next.js Studio on Vercel.
- Use Supabase Auth for invite-only magic-link authentication and Supabase Postgres for durable application state.
- Use AWS S3 for production artifact bytes and MinIO locally behind the same object-storage port.
- Use Trigger.dev Cloud v4 for durable workflow orchestration and worker execution outside Vercel.
- Use Zod for runtime contracts, Vitest for unit/integration tests, pgTAP for database/RLS tests, and Playwright for the critical owner flow.

The database includes accounts and memberships for future-safe authorization, but Phase 1 exposes a single-owner experience only. There is no team management, organization administration, role management, invitation administration, or workspace switching UI.

Provider implementations remain adapters. Domain records use stable internal identifiers. Any Trigger.dev run identifier belongs in a workflow binding rather than becoming the job identity; S3 configuration and request shapes do not become artifact domain contracts.

## Authentication and authorization

Authentication is invite-only and has no public signup. The owner requests or follows a magic link. MFA is not part of the Phase 1 experience, though sensitive later marketplace operations may require stronger authentication.

Postgres row-level security authorizes rows through account membership. Browser code receives only the public Supabase configuration and the authenticated owner's session. Service-role and worker credentials remain server-only and worker functions accept narrowly scoped stable identifiers.

## Object storage

The production S3 bucket is private with Block Public Access and versioning enabled. Runtime credentials have least privilege. Keys are generated server-side from stable IDs, writes use conditional no-overwrite semantics, and persisted SHA-256 provenance is verified against uploaded bytes. Authorized downloads use short-lived signed URLs.

Phase 1 deliberately does not implement S3 Object Lock, cross-region replication, complex WORM governance, or enterprise backup infrastructure. The key and metadata design remains compatible with later hardening.

## Secrets

Phase 1 has no account-scoped provider or Etsy credentials. Platform credentials are stored in Vercel, Trigger.dev, GitHub, Supabase, AWS, or local environment secret stores and never enter browser bundles.

AWS KMS and production encrypted account-secret persistence are deferred. A provider-neutral `SecretStore` port may define a future boundary, but Phase 1 does not create speculative secret tables. Etsy OAuth credential storage will be designed with the Etsy integration phase.

## Backups and recovery

Phase 1 relies on Supabase managed backups and S3 versioning. Future production operations should select a Postgres point-in-time recovery tier, schedule logical exports, document and exercise restore procedures, and evaluate cross-region replication from measured recovery objectives. These are recommendations, not Phase 1 automation.

## Alternatives considered

- Supabase Storage was simpler operationally, but S3 was selected for explicit immutable-write controls and a portable S3-compatible local adapter.
- Inngest and Temporal Cloud can provide durable execution. Trigger.dev Cloud v4 offers a smaller operational surface than Temporal while supporting durable retries, waits, and long-running TypeScript tasks.
- Vercel request functions or browser polling alone cannot own durable work because their lifecycle does not satisfy the browser-close and redeploy requirements.

## Consequences

Local development needs Supabase and MinIO plus a Trigger.dev development connection. Production spans Vercel, Supabase, AWS, and Trigger.dev, so environment contracts, correlation IDs, least-privilege credentials, and provider health documentation are required.
