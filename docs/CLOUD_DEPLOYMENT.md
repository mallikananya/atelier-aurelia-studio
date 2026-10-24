# Step 1 staging deployment preparation

The implementation plan and architecture remain authoritative. This runbook covers
the existing invite-only Studio and durable dummy build only. Preparing settings or
building locally does not establish remote acceptance. Record actual provider IDs,
deployment IDs and commit hashes in the completion checklist only after verification;
never record keys, passwords, connection URLs or signed download URLs.

## AWS-independent Trigger preproduction

On 2026-10-21 the user authorized the existing Free Plan **PROD** environment for
isolated preproduction only, with no actual production data, credentials or
schedules. The project is `atelier-aurelia-studio`, reference
`proj_fielriwlwflsqochecli`, organization `atelier-aurelia-8c3b`. The provider's
paid **Staging** environment is not required for this authorized path. Do not
upgrade the plan, add unrelated infrastructure, or treat this as a production launch.

The dispatcher and reconciler now have **no declarative cron**. Deployment/dev
startup does not install schedules. Explicit dashboard attachment is the only
schedule opt-in. Existing imperative schedules survive code changes: before any
deployment inspect this project's PROD Schedules view and disable any test schedules
already present; verify none are active. Do not touch unrelated projects or real
production schedules. [Trigger schedule behavior](https://trigger.dev/docs/tasks/scheduled).

The AWS hold remains on actual build execution: do not select **Run Test Build**,
manually run the dispatcher/build/reconciler, or attach their schedules until private
AWS storage and restricted runtime access pass AWS acceptance. Do not replace S3 or
weaken immutable-write verification. Deployment and the bounded smoke below are
AWS-independent; neither closes durable workflow acceptance.

### Deployment and bounded smoke

1. In Computer Use, verify the exact organization, project and **PROD** environment
   above. It is isolated preproduction by explicit user authorization. Leave AWS,
   database and production credentials absent for the credential-free smoke.
   Set the non-secret `TRIGGER_PROJECT_REF=proj_fielriwlwflsqochecli` in the
   target Cloud environment as well as the deployment shell: remote indexing
   imports the config and requires this value. Runtime is explicitly `node-24`.
2. Authenticate the pinned CLI using its interactive browser login. The account
   owner completes authorization/MFA themselves. Alternatively, the owner can
   install a private `TRIGGER_ACCESS_TOKEN` in their deployment environment; never
   pass it as a CLI argument, paste it in chat or copy it into runtime settings.
   The CLI access credential differs from Cloud's runtime `TRIGGER_SECRET_KEY`.
3. From the repository root use these explicit, project-pinned scripts:

   ```sh
   npm run trigger:prepare:preproduction --workspace=@atelier-aurelia/workflows
   npm run trigger:deploy:preproduction --workspace=@atelier-aurelia/workflows
   ```

   The first targets `prod` with `--dry-run`, producing a bundle without deployment;
   the second deploys to the same authorized project/environment. Both pin CLI 4.6.3
   to match the SDK and skip update checks. The generic `trigger:deploy` script
   fails with instructions to choose a target. Dry-run can require network/CLI
   authentication. Inspect output locally without publishing bundles or debug logs.
   [CLI deploy options](https://trigger.dev/docs/cli-deploy-commands).
4. Confirm the deployed version contains the three existing task IDs and
   `atelier-phase1-cloud-smoke`. In the dashboard run **only** the smoke task once
   with payload `{}`. It accepts no extra fields, has concurrency one, one attempt
   and a 30-second maximum. It imports no database/storage adapter, reads no secrets,
   and returns `{ "status": "ok", "scope": "cloud-runtime-only" }`.
5. Record the deployment ID, reviewed commit and completed smoke run ID. Verify
   there are no active schedules or unintended queued/running jobs. Stop any test
   schedules after the validation window. Do not repeat or automate smoke runs.

This proves only that Trigger Cloud can deploy and execute the code. It does not
prove database connectivity, persistence, job binding, retries, artifact integrity
or browser-independent durability.

### Later AWS-backed acceptance

After AWS passes, populate only preproduction runtime values in the table below.
Use the restricted staging database LOGIN with `sslmode=verify-full` through a
direct or session-pooled connection; transaction pooling breaks advisory locks.
Never use `postgres`, service-role credentials or a real production database.
Cloud supplies its own runtime API key; the staging web host needs no Trigger key
for enqueueing.

For the bounded acceptance window, explicitly attach these imperative schedules in
the selected preproduction environment's dashboard, avoiding duplicate schedules:

| Task | Cron (UTC) |
| --- | --- |
| `atelier-generation-dispatcher` | `* * * * *` |
| `atelier-generation-reconciler` | `*/5 * * * *` |

Run the existing full durability/retry/cancellation acceptance, then disable both
schedules and verify no jobs remain executing. Do not leave preproduction polling
unattended. Deployment does not recreate these imperative schedules or enable them.
The existing explicit `trigger:prepare:staging` and `trigger:deploy:staging` scripts
remain available only if a paid Staging environment is separately authorized later.

## Netlify Free staging preparation

On October 24, 2026, the user approved Netlify Free as the commercial-use staging
host because Vercel Hobby is restricted to personal or non-commercial use. This is
a staging-host substitution only: the Next.js application, Supabase, Trigger.dev,
and AWS boundaries remain unchanged. The production-host decision remains Vercel
unless a later architecture decision changes it.

Connect only `mallikananya/atelier-aurelia-studio`. Netlify calls the main site URL
a production deploy; for Step 1 it is the isolated staging application and must not
contain production data, schedules, or credentials. Free has a hard monthly credit
limit and no automatic recharge. Do not enable paid add-ons or auto recharge.

| Netlify setting | Repository value |
| --- | --- |
| Framework | Next.js |
| Base directory | Repository root (unset/default) |
| Package directory | `apps/studio` |
| Node.js version | 22.x |
| Build command | `npm run build --workspace=@atelier-aurelia/studio` |
| Publish directory | `apps/studio/.next` |

`netlify.toml` records the non-secret build settings. Keep the root lockfile and all
workspace sources available. The Vercel file remains for the approved production
architecture and is not used by Netlify staging.
[Netlify monorepos](https://docs.netlify.com/build/configure-builds/monorepos/),
[Next.js on Netlify](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/).

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

Use Netlify's Git integration so the reviewed `main` commit and build settings are
visible in one place. Configure environment values in the dashboard, scoped only to
this site. Do not copy `.env`, enable auto recharge, or install optional integrations.

## Environment separation

| Variable | Netlify staging | Trigger isolated preproduction (provider PROD) |
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
- Netlify: exact staging origin, callback, authentication and Products smoke checks;
  deployment ID and tested commit recorded.
- AWS: policy/configuration and real storage acceptance explicitly pending while
  the support ticket blocks provisioning.
- Trigger: dry-run, isolated preproduction deployment and one-off credential-free
  smoke are separate AWS-independent checks. All build execution/schedules remain
  pending until AWS passes; disable test schedules after acceptance.
- Full Step 1: a real bound Cloud job survives browser closure/Studio redeploy;
  retries/cancellation reconcile to persisted terminal state; exact-version bytes,
  SHA-256, authorized download and tenant isolation verified. These remain pending
  until AWS and Cloud execution are available. Local substitutes cannot close them.

Do not begin Step 2 while these Step 1 gates remain open.
