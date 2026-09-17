# Phase 1 local development

## Prerequisites

- Node.js 22 and npm
- Docker Desktop (required by the Supabase CLI and MinIO Compose service)
- A Trigger.dev account/project for the real durable-worker path

## Setup

1. Copy `.env.example` to `.env` and set non-production local credentials.
2. Run `npm ci`.
3. Run `npm run db:start`; copy the printed publishable and service-role keys into `.env`.
4. Run `npm run db:reset` to replay migrations and test seed data.
5. Run `npm run infra:start` to start MinIO and create the private, versioned artifact bucket.
6. Run `npm run dev` for the Studio.
7. Run the Trigger.dev development command documented by `apps/worker` once that milestone is installed.

Mail from local Supabase Auth appears in Inbucket at `http://127.0.0.1:54324`. The MinIO console is at `http://127.0.0.1:9001`.

Do not reuse local credentials in Vercel, Supabase, AWS, or Trigger.dev. `.env` is ignored and must never be committed.

## Milestone 4 database boundary

The three initial migrations create the 13 approved persistence tables, membership-based
RLS, immutable revision/artifact/history guards, transactional product/revision/enqueue
commands, and private worker functions. They are an initial schema, not an upgrade from
an existing deployed database. Subsequent deployed changes need new forward migrations.

Run the real local validation before changing database contracts:

```sh
npm run db:start
npm run db:reset
npm run db:test
```

`db:reset` destroys this project's local development database. The seed deliberately
contains no owner, passwords, templates, or creative catalogs. Behavioral pgTAP fixtures
create users and tenant data inside rollback transactions. Their temporary worker-role
grants exist only to exercise the production function grants and roll back with the data.

Operational contracts for later adapters:

- With public signup disabled, invite the intended owner first through a trusted Supabase
  administrator. The first Auth user creates the owner account; later Auth users receive
  no account membership automatically. This bootstrap is database plumbing, not a login UI.
- Authenticated sessions can read their own account's rows and invoke the three closed
  product/revision/enqueue commands; they cannot directly mutate tables or call workers.
- `atelier_worker` is a NOLOGIN role with only private function execution. Provision a
  dedicated server-only login with permission to assume this role when implementing the
  worker adapter. Do not use the Supabase service-role key as the worker permission model.
- Enqueue replay returns the original job even after the current revision advances. A new
  idempotency key can build only the current revision. Reusing a key for different work fails.
- Claiming an outbox item transitions queued to dispatched (dispatch has begun). Binding
  records the provider run separately. A worker attempt can start only after binding;
  an early provider callback must retry that database step. Lease tokens expire against
  wall-clock time, and reclaims rotate them. The tenth reported dispatch failure marks the
  item dead and the job failed.
- Provider attempt identifiers deduplicate starts. Only one attempt can run at once.
  Progress, completion, and failure use the stable attempt identity; stale attempts cannot
  change a newer attempt's progress or outcome. The provider adapter must report failed or
  crashed attempts before starting their replacements; never silently replace an active
  attempt. Attempt exhaustion is final even if the provider omits its final-failure hint.
- Persist artifact metadata only after upload and byte/hash verification. The database
  validates identity, generated key structure, positive byte length, version, and SHA-256
  syntax; it cannot verify remote object bytes. Artifact completion replay must match the
  original metadata and successful attempt. The SQL revision hash is SHA-256 of PostgreSQL's
  `jsonb::text` representation, not an independently serialized JavaScript object.
- The approved domain transition `failed -> queued` requires a prepared pending outbox,
  remaining attempt/dispatch budget, cleared terminal fields, and no previous workflow
  binding or running attempt. This prevents a state-only update from stranding work.
  Bound or exhausted workflows require a new job identity. No public retry or cancellation
  command is implemented in this milestone; a later retry command must coordinate this
  operation transactionally.

Milestone 5 is the invite-only Supabase magic-link authentication slice: server-side
session handling, validated callback/redirect handling, protected Studio routes,
logout, and authorization tests for the invited owner, anonymous sessions, and users
without membership. It must retain disabled public signup and keep credentials off the
client. Product UI, object-storage adapters, and durable workflow execution follow their
own milestones. Milestone 5 requires explicit approval before implementation.
