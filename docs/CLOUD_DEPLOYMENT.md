# Step 1 staging deployment preparation

The implementation plan and architecture remain authoritative. This runbook covers
the existing invite-only Studio and durable dummy build only. Preparing settings or
building locally does not establish remote acceptance. Record actual provider IDs,
deployment IDs and commit hashes in the completion checklist only after verification;
never record keys, passwords, connection URLs or signed download URLs.

## Current AWS hold

Remote Supabase migrations, Auth settings and restricted worker login preparation
can proceed independently. Trigger Cloud project/environment setup and Vercel
Preview preparation can also proceed. **Do not deploy the Trigger tasks, start a
remote-connected dev worker, enable schedules, or select Run Test Build until the
private AWS bucket and restricted runtime access pass AWS acceptance.**

Both existing schedules are declarative and synchronize on deployment/dev startup:
`atelier-generation-dispatcher` runs every minute and
`atelier-generation-reconciler` every five minutes. Deploying then disabling them
leaves a race. Hold deployment itself while AWS is unavailable. Do not replace S3
with Supabase Storage or weaken immutable-write checks to bypass this gate.
[Trigger schedule synchronization](https://trigger.dev/docs/tasks/scheduled).

## Trigger.dev Cloud staging

Computer Use inspection on 2026-10-14 verified project `atelier-aurelia-studio`,
reference `proj_fielriwlwflsqochecli`, in organization `atelier-aurelia-8c3b`.
The Free Plan exposes Development and Production, while Staging displays an
**Upgrade** link. **Staging is blocked on a paid plan decision; no upgrade has
been authorized or performed.** No development tasks were connected at inspection.
Keep the staging commands below prepared; do not deploy to Production as a
substitute and do not interpret a missing staging environment as a reason to create
unrelated infrastructure. The AWS execution hold also remains in force.

1. In Computer Use, select the intended organization/project at
   [Trigger.dev Cloud](https://cloud.trigger.dev). Record the non-secret `proj_...`
   reference. Select **Staging**, distinct from Development and Production. Preserve
   `packages/workflows/trigger.config.ts`; do not run an initializer.
2. Let the account owner complete sign-in, MFA, credential entry or secret transfer
   directly. CLI login uses a deployment access token/session; task runtime API keys
   are a different credential. Do not put either key in source or shell arguments.
3. Configure the staging-only `WORKER_DATABASE_URL` through the secret field. Use
   the dedicated restricted LOGIN, `sslmode=verify-full`, and a direct or **session**
   pooler connection. Transaction pooling cannot retain the job advisory lock.
   Never use `postgres`, service-role credentials, or production's job database.
4. Leave AWS-dependent variables pending until the AWS acceptance gate clears.
   The Cloud runtime supplies its own `TRIGGER_SECRET_KEY`; do not override it with
   another environment's key. The app needs no Trigger key for enqueueing.
5. Set the non-secret `TRIGGER_PROJECT_REF` in the deployment shell. Use the pinned
   CLI/SDK version 4.6.3. From the repository root, the preparation command is:

   ```sh
   npm run trigger:prepare:staging --workspace=@atelier-aurelia/workflows
   ```

   This uses `--env staging --dry-run`, creates a deployable bundle without deploying
   it, and can still require CLI authentication/network access. Inspect the bundle
   locally; do not publish its contents or debug logs. A missing authorized account
   is a pending build check, not a successful dry run. Do not use the generic
   `trigger:deploy` script: the provider default is Production.
   [CLI environment and dry-run options](https://trigger.dev/docs/cli-deploy-commands).

After AWS acceptance, populate Trigger staging's bucket, region and runtime secrets
from the table below, confirm the dedicated database connection, then run:

```sh
npm run trigger:deploy:staging --workspace=@atelier-aurelia/workflows
```

Confirm the dashboard target is **Staging**, both schedules are attached to this
deployment, and all three task IDs are present (including
`atelier-phase1-test-build`). Record the deployment ID and reviewed commit. Live
durability/retry/cancellation acceptance remains separate from a successful deploy.

## Vercel Preview preparation

Use the intended Vercel team/project and Preview environment as staging. Project
creation/import can initiate a build, so first review the target and environment
settings in Computer Use. Do not enable a production release or add a deployment
automation as part of this work.

| Project setting | Repository value |
| --- | --- |
| Framework | Next.js |
| Root Directory | `apps/studio` |
| Include source files outside Root Directory | Enabled; Studio imports `packages/storage` |
| Node.js version | 22.x |
| Install Command | `cd ../.. && npm ci` |
| Build Command | `npm run build` (runs in `apps/studio`) |
| Output Directory | `.next` |

`apps/studio/vercel.json` records the build settings. Root Directory and inclusion
of source outside it are dashboard settings, not fields in this file. Keep the
root lockfile and all workspace sources available to the build.
[Vercel build settings](https://vercel.com/docs/builds/configure-a-build),
[monorepo file access](https://vercel.com/docs/monorepos/monorepo-faq).

Configure the three browser-safe variables below for the intended Preview branch.
`NEXT_PUBLIC_APP_URL` must be the exact stable HTTPS staging origin, without a path.
Coordinate that origin with Supabase Site URL and its exact `/auth/confirm` redirect
allowlist before sending invitations. Avoid wildcard callback hosts. Public Next.js
variables are embedded at build time, so changing the staging origin requires a
new build. Do not reuse one build across differing Supabase/origin targets.

A Preview can validate login, account scoping, Products and immutable Revision 1
before AWS is ready. Do not enqueue builds or claim downloads work. If Preview
protection is enabled, the intended owner needs access before following email links.
Do not disable protection merely to make automation pass.

For a CLI-driven Preview, first use interactive `vercel link` from the repository
root to select the reviewed existing team/project. Verify its dashboard Root
Directory is `apps/studio`, then use an installed, reviewed Vercel CLI:

```sh
vercel pull --environment=preview
vercel build
vercel deploy --prebuilt --target=preview
```

These commands fetch private configuration and the last command deploys remotely;
execute only at the deployment milestone with the target/commit checked. Keep
`.vercel/` ignored and never upload it as an artifact. Do not use `--prod`,
`promote`, or production environment values. Prefer the dashboard/Git Preview path
when CLI prebuilt limitations affect Next.js behavior.
[Vercel deployment options](https://vercel.com/docs/cli/deploy).

## Environment separation

| Variable | Vercel Preview | Trigger Staging |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | Exact stable staging origin | Not needed |
| `NEXT_PUBLIC_SUPABASE_URL` | Remote staging Supabase URL | Not needed |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Staging publishable key | Not needed |
| `WORKER_DATABASE_URL` | Never | Restricted LOGIN secret, verified TLS/session connection |
| `TRIGGER_SECRET_KEY` | Never | Provider-managed environment key |
| `OBJECT_STORAGE_BUCKET`, `OBJECT_STORAGE_REGION` | Pending AWS | Pending AWS; same staging bucket/region |
| `OBJECT_STORAGE_FORCE_PATH_STYLE` | `false` when AWS configured | `false` when AWS configured |
| `OBJECT_STORAGE_ENDPOINT` | Omit for AWS | Omit for AWS |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, optional `AWS_SESSION_TOKEN` | Server-only restricted signing identity, pending AWS | Server-only restricted worker identity, pending AWS |
| `ARTIFACT_SIGNED_URL_TTL_SECONDS` | `60` | Not needed |

No deployed runtime needs `SUPABASE_SERVICE_ROLE_KEY`, administrative `DATABASE_URL`,
MinIO administrator variables, or CLI `TRIGGER_ACCESS_TOKEN`. Do not copy the local
`.env` wholesale. Use short-lived provider credentials where supported; expired
temporary tokens must be renewed before acceptance. Never expose worker, AWS or
deployment secrets with `NEXT_PUBLIC_`.

## Live acceptance gates

- Remote Supabase: forward migrations, invite-only owner login, RLS isolation and
  dedicated worker restrictions verified against the actual remote project.
- Vercel: exact Preview origin, callback, authentication and Products smoke checks;
  deployment ID and tested commit recorded.
- AWS: policy/configuration and real storage acceptance explicitly pending while
  the support ticket blocks provisioning.
- Trigger: dry-run bundle result recorded separately; staging deployment/schedules
  remain pending until AWS passes.
- Full Step 1: a real bound Cloud job survives browser closure/Studio redeploy;
  retries/cancellation reconcile to persisted terminal state; exact-version bytes,
  SHA-256, authorized download and tenant isolation verified. These remain pending
  until AWS and Cloud execution are available. Local substitutes cannot close them.

Do not begin Step 2 while these Step 1 gates remain open.
