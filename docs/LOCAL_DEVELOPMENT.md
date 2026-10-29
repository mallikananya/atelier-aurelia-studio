# Local-first development

## Prerequisites

- Node.js 22 and npm
- Docker Desktop (required by the Supabase CLI and MinIO Compose service)
- `openssl` for generating local-only credentials

Trigger.dev Cloud, AWS, production SMTP, and any paid service are optional. The
default local path uses Supabase's Docker-backed PostgreSQL/Auth/Mailpit stack,
MinIO, and the repository's local workflow runner.

## Setup

1. Install dependencies with `npm ci`.
2. Copy `.env.example` to `.env` if it does not already exist. Set distinct,
   randomly generated local values for `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`,
   `AWS_ACCESS_KEY_ID`, and `AWS_SECRET_ACCESS_KEY`.
3. Start the existing local services with `npm run local:start`. This is
   non-destructive: it neither resets PostgreSQL nor removes Docker volumes.
4. Run `supabase status -o env` and copy `PUBLISHABLE_KEY` to
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SERVICE_ROLE_KEY` to
   `SUPABASE_SERVICE_ROLE_KEY` in `.env`.
5. Prepare a restricted local worker login by applying
   `supabase/admin/prepare_worker.sql`, verifying it with
   `supabase/admin/verify_worker.sql`, then enabling `atelier_worker_login` with a
   local-only random password. Set `WORKER_DATABASE_URL` to that login on
   `127.0.0.1:54322`; never use the `postgres` or service-role credentials.
6. Start the Studio with `npm run dev` and, in a second terminal, the local worker
   with `npm run worker:local`.

The worker-role commands are intentionally interactive so its password is not placed
in shell history:

```sh
docker exec -i supabase_db_atelier-aurelia-studio psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /dev/stdin < supabase/admin/prepare_worker.sql
docker exec -i supabase_db_atelier-aurelia-studio psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /dev/stdin < supabase/admin/verify_worker.sql
docker exec -it supabase_db_atelier-aurelia-studio psql -U postgres -d postgres -c '\password atelier_worker_login'
docker exec supabase_db_atelier-aurelia-studio psql -U postgres -d postgres -c 'alter role atelier_worker_login login'
```

The root `dev`, storage, workflow, and browser-test scripts load the ignored root
`.env` explicitly. Mail from local Supabase Auth appears in Mailpit at
`http://127.0.0.1:54324`. Supabase Studio is at `http://127.0.0.1:54323`; the MinIO
console is at `http://127.0.0.1:9001`.

Stop the foreground Studio and worker with `Ctrl-C`, then stop services without
deleting data:

```sh
npm run local:stop
```

Do not use `npm run db:reset` for routine startup or verification. It destroys the
project's local development database and is retained only for an explicitly approved,
disposable clean-room acceptance run.

Do not reuse local credentials in Vercel, Supabase, AWS, or Trigger.dev. `.env` is ignored and must never be committed.

## Milestone 4 database boundary

The three initial migrations create the 13 approved persistence tables, membership-based
RLS, immutable revision/artifact/history guards, transactional product/revision/enqueue
commands, and private worker functions. They are an initial schema, not an upgrade from
an existing deployed database. Subsequent deployed changes need new forward migrations.

Run the real local validation before changing database contracts:

```sh
npm run db:start
npm run db:test
```

`db:test` is safe on a populated development database: behavioral pgTAP fixtures create
their own users and tenant data inside rollback transactions. Their temporary worker-role
grants exist only to exercise the production function grants and roll back with the data.
`db:reset` remains destructive and requires explicit approval.

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
own milestones. Milestone 5 is complete.

## Milestone 6 Products flow

The owner can create a named product from `/products` and open its persisted detail
at `/products/[productId]`. The library reads account-scoped rows with the owner's
session and RLS. Creation calls `create_product_with_revision` through an authenticated,
same-origin Server Action; PostgreSQL owns Revision 1, provenance, schema and hash.
No migration, privileged runtime client, product taxonomy or later workspace is added.

The form disables submission while pending and redirects after success. The existing
command has no idempotency key: replaying a separate request creates another product,
each with exactly one Revision 1. The application never automatically retries an
uncertain write and asks the owner to check the library before trying again.

For local acceptance, reset the disposable development database, run `npm run db:test`,
then run `npm run test:e2e` with `NEXT_PUBLIC_APP_URL`,
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and local
`SUPABASE_SERVICE_ROLE_KEY` set. The last key is used only for local test fixture
provisioning; browser and persistence assertions use authenticated public-key clients.
Tests refuse an unrelated existing owner and never delete fixture data. The empty-state
case requires a fresh reset. The full suite contains nine auth and six Products cases.

## Milestone 7 private artifact storage

`packages/storage` implements the existing `BlobStore` port using the AWS S3 SDK.
The server derives `accounts/<account>/products/<product>/revisions/<revision>/artifacts/<artifact>/payload.txt`
from trusted UUIDs. `uploadVerifiedArtifact` snapshots bytes, calculates SHA-256, uses
`If-None-Match: *` and a SHA-256 transport checksum, requires a non-null version, and reads that exact version back.
It compares content type, metadata digest, declared size, streamed size and the hash
of the actual read-back bytes. ETags are never interpreted as SHA-256. Only successful
verification invokes the caller's database completion boundary. The existing
`private.worker_complete_test_build` command remains the metadata authority; no
schema migration is required.

There is deliberately no production upload UI, worker, dispatcher or generator in
this slice. The deterministic acceptance fixture creates a job/attempt through the
existing commands, uploads actual bytes to MinIO, and completes metadata as
`atelier_worker`. Its local Docker administrator is used only to assume the existing
worker role and provision test accounts; runtime privileges are unchanged. Failed
upload and fault-injected corrupt/incorrect-size readbacks are checked against real
Postgres to confirm no available artifact appears. Fault injection is not a claim
that MinIO corrupted stored data.

Authenticated Product detail shows a minimal download link for available artifacts
on its current revision. `/artifacts/<artifactId>/download` verifies the owner session,
queries the account-scoped artifact under RLS, checks canonical identity and configured
bucket, and only then signs the stored version. Buckets and keys cannot be supplied
by the browser. Missing, malformed and unauthorized requests return the same 404;
backend failures return a sanitized 503. Redirects use `private, no-store` and
`no-referrer`. The signed response forces attachment download and private, no-store caching.

### Local configuration and validation

Use distinct randomly generated local credentials for `MINIO_ROOT_USER` /
`MINIO_ROOT_PASSWORD` (administration) and `AWS_ACCESS_KEY_ID` /
`AWS_SECRET_ACCESS_KEY` (runtime). Do not reuse production credentials. `infra:start`
creates a private, versioned bucket and grants the runtime user only GetObject,
GetObjectVersion and PutObject beneath `accounts/`; it cannot delete objects or
administer the service. `infra/artifact-runtime-policy.json` is the local policy
template. Ports bind only to loopback. Both pinned MinIO images now use Quay because
the previously configured Docker Hub images could not be pulled during acceptance.

Set the existing endpoint, region, bucket and path-style variables from `.env.example`.
`ARTIFACT_SIGNED_URL_TTL_SECONDS` defaults to 60 and must be an integer from 1 to 300.
Endpoint credentials, non-HTTPS remote endpoints and malformed configuration fail
closed. Local HTTP loopback is supported. The app reads storage configuration only
in a server-only module after authorization; provider secrets never enter UI props.

The root development and real-service test scripts load `.env` through the checked-in
launcher:

```sh
npm run infra:start
npm run db:test
npm test
npm run test:storage
npm run test:workflows
npm run test:coverage
npm run typecheck
npm run lint
npm run build
npm run guardrails
npm audit --omit=dev
git diff --check
```

The full browser suite is separate from routine non-destructive validation. It must
start after an explicitly approved clean disposable database reset because it runs
Auth and Products acceptance before storage fixtures, preserving the existing empty
Products assertion. Storage fixtures leave immutable data in place; do not treat a
second full run without reset as an empty-account test. The browser suite also needs
the local Supabase service-role key solely for test Auth/account provisioning, as
in Milestones 5–6. Real MinIO tests require an explicitly local storage endpoint;
they fail rather than silently skip when unavailable. No live AWS test is implied.

### Production S3 requirements

Provision a private general-purpose S3 bucket with versioning **Enabled**, all four
Block Public Access settings enabled, and Bucket owner enforced object ownership
(ACLs disabled). Omit `OBJECT_STORAGE_ENDPOINT` and use the AWS region; set
`OBJECT_STORAGE_FORCE_PATH_STYLE=false`. Use short-lived role credentials through
the SDK default credential chain where available, or server-only platform secret
configuration. A temporary session token may use `AWS_SESSION_TOKEN`.

Grant runtime identities only the required prefix-scoped `s3:PutObject`,
`s3:GetObject` and `s3:GetObjectVersion` permissions. They must not have object or
version deletion, bucket policy/ACL administration, or permission to suspend
versioning. Do not attach broader policies to the local runtime user either.
Production bucket policy should deny non-TLS access and enforce conditional
PutObject writes (`s3:if-none-match`) as described in
[AWS conditional-write enforcement](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes-enforce.html).
`If-None-Match: *` checks the current version; deletion markers could allow key
reuse, which is why runtime deletion and lifecycle deletion of artifact identities
must remain disabled. Versioning alone does not enforce no-overwrite.

This milestone does not provision or audit a live AWS account. Bucket privacy,
versioning, IAM and policy deployment must be verified before production use.
MinIO acceptance verifies actual local privacy and denied deletion; the SDK adapter
never sets public ACLs or grants anonymous access.

### Failure and recovery limits

Storage and Postgres do not share a transaction. A failed verification or database
completion can leave a private unreferenced object. The adapter never deletes it or
retries an uncertain write automatically, and a repeated put to the same existing
key fails, even for identical bytes. Recovery/reconciliation belongs to the later
durable workflow slice and must preserve immutable identities. Database completion
itself retains its existing exact-metadata replay behavior.

Real MinIO concurrent-write acceptance reproduced a stale keep-alive socket reset
after a conditional rejection. Storage requests now use fresh TCP/TLS connections
with one attempt; this deliberately trades connection reuse for predictable
Phase 1 behavior without retrying uncertain writes.

Signed URLs are bearer capabilities until expiry; logout or later membership changes
do not revoke a URL already issued. Do not log or persist them, and disable capture
of download response headers in production observability. Object Lock, cross-region
recovery, user uploads, generation and durable test builds remain deferred.

## Milestone 8 — durable Phase 1 execution

`packages/workflows` is a separate server-side workspace using pinned Trigger.dev
SDK **4.6.3**. PostgreSQL remains authoritative. The authenticated Product detail
button only invokes the existing enqueue command. It derives a stable key from the
persisted revision; repeated clicks reuse that job. The proof artifact is bounded
plain-text JSON containing the immutable revision identity, name and database hash.
It is not a finished generated product.

The Cloud dispatcher polls the existing leased outbox every minute (25 claims per
invocation). Each job uses a globally scoped Trigger idempotency key with 30-day TTL.
Only the job UUID is sent as task payload. The returned run ID is bound under the
outbox lease; the worker must match that binding before reading revision content.
An acceptance-before-bind crash recovers via lease expiry and the same provider key.
Even after provider key expiry, only the database-bound run may execute.

Execution holds a per-job PostgreSQL session advisory lock. A forward migration
adds a private provider-attempt fence; a newer retry retires an interrupted attempt,
while old attempts cannot complete or mutate replacements. A same-attempt resumed
invocation can proceed after its previous database session ends. Each invocation
uses a new random immutable artifact ID; storage verification precedes the existing
completion transaction. An uncertain database response is resolved by reading the
job on replay. A committed success is never re-uploaded or failed.

Partial uploads may leave private unreferenced objects. They are not overwritten,
deleted, or exposed as available artifacts. A retry creates a new identity. This
preserves Milestone 7's fail-closed immutable write and exact-version contracts.

Builds have three provider attempts, a five-minute compute limit, and retry delays
of at least 130 seconds to permit dispatch lease recovery. Cancellation/failure hooks
reconcile terminal state. A separate five-minute Cloud schedule checks bound active
runs if a hook was interrupted. A provider `COMPLETED` run without database success
is a failure, never evidence of verified completion. No browser cancellation UI is
added; an operator can cancel a bound run in Trigger. Final failed jobs remain
terminal; use a new job identity for new work, never rearm a delivered outbox.

### Optional Trigger.dev Cloud setup

Reuse the existing [Trigger.dev Cloud](https://cloud.trigger.dev) project
`proj_fielriwlwflsqochecli`; do not create a duplicate project.
The repository configuration already exists; do not run an initializer that replaces
it. Use [Trigger's setup guide](https://trigger.dev/docs/quick-start) for account
onboarding. Set `TRIGGER_PROJECT_REF` in your private shell/CI environment before
running workspace CLI commands. The deploy artifact is the workflows workspace;
Next.js continues to deploy separately to Vercel.

```sh
npm run trigger:dev --workspace=@atelier-aurelia/workflows
npm run trigger:prepare:preproduction --workspace=@atelier-aurelia/workflows
npm run trigger:deploy:preproduction --workspace=@atelier-aurelia/workflows
```

These scripts use the matching pinned CLI via `npx`. CLI authentication uses an
interactive browser login or a private `TRIGGER_ACCESS_TOKEN` in CI. Do not paste
credentials into chat or commit them. Deployment details are in
[Trigger's deployment guide](https://trigger.dev/docs/deployment/overview).

Configure the following in the target Trigger environment's **Environment Variables**
settings before deployment, separately for development/staging/production:

| Variable | Where / purpose |
| --- | --- |
| `TRIGGER_PROJECT_REF` | Local deployment shell/CI and target Cloud environment; non-secret project selector required when the remote indexer imports the config. |
| `TRIGGER_ACCESS_TOKEN` | CI secret for deployment, or use interactive CLI login. |
| `TRIGGER_SECRET_KEY` | Local dev worker shell when needed; target environment server API key for task dispatch/run inspection/cancellation. Cloud supplies its own runtime key; never expose one to the browser. |
| `WORKER_DATABASE_URL` | Trigger runtime secret: dedicated PostgreSQL LOGIN granted only `atelier_worker`; direct or session-pooled connection, remote `sslmode=verify-full`. |
| `OBJECT_STORAGE_BUCKET`, `OBJECT_STORAGE_REGION` | Trigger runtime, matching app storage configuration. |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, optional `AWS_SESSION_TOKEN` | Trigger runtime secret storage credentials with Milestone 7 restricted permissions. |
| `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_FORCE_PATH_STYLE` | Local MinIO dev; omit endpoint for AWS and set path style false. |

See [Trigger environment variables](https://trigger.dev/docs/deploy-environment-variables).
Do not configure worker database credentials or Trigger credentials as `NEXT_PUBLIC_*`
or use the Supabase service-role API key as worker authorization. Vercel needs no
Trigger key for enqueueing. The application retains its existing storage download
credentials. Provision the dedicated database login through the trusted database
administrator using a secret manager-generated password, with `NOINHERIT`, no
superuser/database/role creation privileges, and membership in `atelier_worker`.
The adapter assumes that role for each command. Do not grant table access. Apply
repository migrations before enabling Cloud schedules.

Cloud workers cannot reach localhost Supabase/MinIO. Use a reachable staging
PostgreSQL/Supabase and private S3 bucket for Cloud acceptance. Local CLI development
can connect to local services but still requires a Trigger Cloud project; the default
`npm run worker:local` path does not. Verify the two schedules are configured manually
only after the database and AWS acceptance
prerequisites pass. Deployment does not install or enable schedules automatically.
For the authorized Free Production preproduction smoke, follow
[the isolation checks](CLOUD_DEPLOYMENT.md) and leave all schedules disabled.
Never point staging and production schedules at the same job database.

### Local acceptance and pending live acceptance

`npm run test:workflows` uses real local PostgreSQL/MinIO and a temporary restricted
LOGIN. It verifies both the existing durable workflow core and the local runner; only
the Trigger Cloud transport is absent. The routine non-destructive sequence is:

```sh
npm run db:test
npm test
npm run test:workflows
npm run test:storage
npm run test:coverage
npm run typecheck
npm run lint
npm run build
npm run guardrails
npm audit
npm audit --omit=dev
```

Run `npm run test:e2e` only for an explicitly approved disposable clean-database
acceptance run. Do not reset a working local database merely to satisfy its empty-owner
fixture precondition.

The production dependency tree has a patched `ws` override for the SDK's transitive
socket client. The deployment CLI is downloaded on demand and is not part of the
production runtime dependency audit; audit/review that tooling separately when
performing deployment.

Live Cloud acceptance remains an explicit gate: deploy to the selected project,
enqueue a real persisted job from the owner UI, close the browser/redeploy the web
app, observe the bound run, and download verified persisted bytes. Exercise retries
and operator cancellation and verify database terminal state. Local substitute tests
do not establish live Cloud durability. Return only the project reference and
confirmation that CLI authentication/runtime secrets are configured to continue.

## First planner: undated weekly edition

This milestone produces one fixed Atelier Aurelia planner locally. It uses the
existing authenticated Products flow, local runner, PostgreSQL job/attempt fencing,
versioned MinIO BlobStore, verified SHA-256 upload and owner-authorized download.
There is no external generation API or paid dependency.

For an existing local installation, apply only pending migrations (never reset):

```sh
npx supabase migration up --local
npm run dev
# In another terminal:
npm run worker:local
```

Sign in as the invited owner, create/open a product, then select **Generate planner
PDF**. Refresh build status until succeeded and select **Download planner PDF**.
Open the downloaded PDF in Preview or a PDF annotation app. Requests for the same
revision and planner edition reuse the same job. The existing Run test build
remains available as an independent infrastructure check. This fixed edition does
not personalize its editorial content from the product's display name.

For a quick local PDF preview without database or storage persistence:

```sh
npm run planner:preview
open output/pdf/atelier-aurelia-undated-weekly.pdf
```

The 146-page, A4 portrait workbook contains:

| Pages | Content |
| --- | --- |
| 1 | Cover |
| 2 | Usage and print guide |
| 3-38 | Twelve monthly sets: overview, six-habit tracker, reflection |
| 39-142 | Fifty-two weekly spreads; all seven days have priority and task space |
| 143-146 | Four lined notes pages |

Print at 100% on A4. Other paper sizes require Fit to page. The PDF uses vector
text/rules with 48-point margins, standard PDF serif/sans fonts, a white background
and restrained grey-green ink. It is suitable for handwriting/annotation, with no
fillable fields or hyperlinks. A physical printer proof remains an owner review
step; automated checks cannot establish print feel or personal usability.

Validation parses every page and content stream, checks exact section titles,
page count/dimensions and PDF envelope, and computes SHA-256. Rendering is
byte-identical across repeated runs with the pinned dependencies. The persisted
job type `planner_pdf_v1` and PDF producer `aurelia-weekly-v1` identify the edition;
future editorial changes should use a new version rather than silently replacing
this edition. `plannerManifest` supplies stable page IDs and ordering.

```sh
npm run test:unit -- --coverage
npm run test:workflows
npm run test:storage
npm run db:test
npm run test:e2e -- zz-workflows.spec.ts
node tools/run-with-env.mjs npm run build
```

The workflow integration test preserves its actual verified MinIO download in
`output/pdf/atelier-aurelia-undated-weekly.pdf` and identifiers/checksum in
`output/pdf/local-planner.json`. These generated files are ignored by Git. Tests
add isolated local products; they do not reset the database. For visual inspection
with Poppler: `pdftoppm -scale-to 1000 -png output/pdf/atelier-aurelia-undated-weekly.pdf tmp/pdfs/page`
(create `tmp/pdfs` first). Inspect cover, guide, monthly overview, habits,
reflection, both weekly pages and notes at readable zoom, plus page thumbnails.

## CE-02 local planning

Apply the pending function migration with `npx supabase migration up --local`; do not
reset the database. Sign in, create a product in Products, then select it in Studio
(or open its detail page). Enter a freeform idea and choose **Generate planning
revision**. Each success appends an immutable revision. Expand history to inspect
briefs, visual direction, page identities/dependencies, deliverables and provenance.
The fixed planner build remains a separate, unchanged action.

Planning is explicitly unavailable until a local provider is configured. Supply these
server-only values in the ignored `.env`:

- `PLANNING_PROVIDER_URL`: an HTTP endpoint at literal `127.0.0.1` or `[::1]`, e.g.
  `http://127.0.0.1:11435/plan`. DNS names, remote hosts, credentials and redirects
  are rejected.
- `PLANNING_PROVIDER_ID` and `PLANNING_PROVIDER_VERSION`: identify the actual local
  generator/model adapter, not a fixture or assumed cloud model.
- `PLANNING_PROMPT_VERSION`: version of the prompt implemented by that adapter.

The endpoint accepts the JSON `GenerationRequest` defined in
`packages/ai/src/planning.ts`: idea, sources, retainedPageIds, schemaVersion, attempt,
issues and optional previousOutput. It returns raw JSON matching `CreativePlanV1`,
not an envelope or an API-specific response wrapper. It owns model/prompt selection;
Studio owns lineage and provenance. Each call has a 30-second deadline, and CE-01
allows three total attempts. No local model is installed or bundled by CE-02.

Run the non-destructive CE-02 browser acceptance suite separately from the old
clean-account auth/Products suite:

```sh
node tools/run-with-env.mjs node_modules/@playwright/test/cli.js test --config playwright.ce02.config.mts
```

It starts an isolated Studio on port 3102 and test-only fixture provider on 3103,
uses the existing local owner fixture, and adds products without deleting history.
It covers Studio planning, revision inspection, stale forms, concurrent authenticated
RPC appends and generation/validation failures. It never invokes a live model. Stop
other development servers sharing `apps/studio/.next` before this run. Database pgTAP
tests use rollback transactions and can run on the populated local database.
