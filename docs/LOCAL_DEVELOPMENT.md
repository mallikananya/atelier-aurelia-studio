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
