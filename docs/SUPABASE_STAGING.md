# Supabase Step 1 staging

The first concrete action is to select the intended organization and an empty,
dedicated staging project in the Supabase dashboard (or create that project if none
exists). Verify its non-secret project reference before linking anything. The
repository's `project_id = "atelier-aurelia-studio"` and localhost Auth URLs describe
local development; they do not establish a hosted project or remote configuration.

Observed target (2026-10-24): `atelier-aurelia-studio-staging`, reference
`wasnnohlwphngcvpicbf`, is active on the Free plan. Its Site URL and exact Netlify
`/auth/confirm` redirect are configured. This is the staging project; do not target
another project or database.

### Existing remote history mismatch

The dashboard migration ledger reports no migrations and the
`supabase_migrations.schema_migrations` table does not exist, but the remote staging
database already contains all 13 Step 1 public tables with forced RLS and zero
estimated rows. Read-only catalog verification also found the private execution
fence, expected public and durable worker functions, Auth-user trigger, and the
restricted `atelier_worker` NOLOGIN role. No remote mutation was performed during
this inspection.

Do not run `db push` against this state: the baseline migrations use deliberate
non-idempotent `create table` statements and would fail on existing objects. Do not
mark versions applied merely because representative objects exist. First authenticate
the CLI, capture a schema-only staging dump, and compare tables, columns, constraints,
indexes, functions, triggers, policies, grants, and role attributes against a clean
local application of the four committed migrations. If any drift exists, review a
forward-only reconciliation migration separately. If the schemas are equivalent,
request explicit approval before initializing or repairing the remote migration
ledger with exactly the four committed versions; then re-run `migration list` and a
`db push --dry-run` that must report no pending changes.

## Forward migrations

Have the account owner perform sign-in/MFA and database-password entry directly.
Do not print CLI credentials, connection URLs, `.env`, or saved login files. From
an authenticated CLI, link using the reviewed non-secret project reference:

```sh
npx supabase link --project-ref <staging-project-ref>
npx supabase migration list --linked
npx supabase db push --linked --dry-run
npx supabase db push --linked
npx supabase migration list --linked
```

Use interactive password entry when prompted. Confirm the dry run contains exactly
these existing forward migrations, in order, before applying:

1. `202609140001_phase1_schema.sql`
2. `202609140002_phase1_api.sql`
3. `202609140003_phase1_security.sql`
4. `202609210001_durable_execution.sql`

Do not reset the remote database, seed it with local test users, squash migrations,
or repair history to hide a mismatch. An existing project's unexpected migration
history requires investigation first. Record project reference, migration versions,
and reviewed commit only. The local pgTAP suites create Auth fixtures; do not run
them on remote staging before the intended owner is bootstrapped.

## Invite-only authentication

In Authentication settings, disable new-user signup and anonymous sign-ins; retain
the Email provider, confirmation requirements and existing invite-only flow. Set
Site URL to the exact stable HTTPS Vercel staging origin. Add only that origin's
`/auth/confirm` callback to the redirect allowlist. Copy the complete committed
`supabase/templates/invite.html` and `magic_link.html` into the matching dashboard
email templates: the app expects `token_hash` and the template's existing OTP type.
Local `config.toml` does not automatically apply these hosted Auth settings.

Confirm Auth Users is empty before inviting the intended owner. The first Auth user
creates the single owner account; subsequent users receive no automatic membership.
The account owner supplies the intended email and completes sensitive email delivery
configuration if required. Never create a disposable test user first. Send the
invitation only after the staging origin, templates and callback are configured.
Verify invitation confirmation, sign-in, sign-out, unknown-email rejection, and that
an authenticated nonmember sees no owner records. Do not alter membership rules to
make a smoke test pass. Products and immutable Revision 1 can be checked without AWS;
Run Test Build and artifact download acceptance remain pending.

## Dedicated worker role

After migrations, execute `supabase/admin/prepare_worker.sql` in the reviewed
staging SQL editor, then `supabase/admin/verify_worker.sql`. The provisioning script
creates `atelier_worker_login` with NOLOGIN, NOINHERIT, no administrative flags,
and membership only in the migration-owned `atelier_worker` role. It grants no
application table access and preserves all migrations.

The account owner next sets a strong unique password through an approved secure
interactive database workflow (for psql, `\password atelier_worker_login` avoids
putting the password in SQL history), then enables login:

```sql
alter role atelier_worker_login login;
```

Do not paste passwords into the dashboard SQL editor, chat, source files, or shell
arguments. Run the verification script again after activation. Store the resulting
connection URL directly in Trigger Staging's secret field as `WORKER_DATABASE_URL`.
Use the dashboard's **direct connection** or **session pooler** host on port 5432;
for the shared pooler the username is `atelier_worker_login.<project-ref>`.
URL-encode the credential and require `sslmode=verify-full`. Never disable TLS
verification to work around connection problems. The worker rejects privileged
pooled usernames and Supabase port 6543 because its advisory lock requires a
persistent session. Confirm session mode in the dashboard; custom pooler endpoints
cannot be classified reliably from a URL alone.

Validate an actual connection using the dedicated login without logging its URL:
confirm `session_user`, `SET ROLE atelier_worker`, and `current_user`; verify direct
reads of `public.products`, `private.execution_fences`, and `auth.users` are denied.
Reset the role and close the session. Do not call claim/build RPCs merely to test
connectivity: they can mutate pending jobs. Catalog assertions alone cannot prove
credential validity, TLS, or pooler session behavior. Record those checks separately.

## Local verification of the administrator scripts

After a local database reset, run `prepare_worker.sql` and `verify_worker.sql` on
local Supabase. Then run:

```sh
python3 supabase/admin/test_worker_verifier.py /path/to/docker
```

The harness targets only `supabase_db_atelier-aurelia-studio`. It checks the valid
baseline and ten unsafe privilege changes (tables, schema/database creation,
BYPASSRLS, membership options, function ownership and missing RPC access). Every
mutation runs in a transaction that rolls back on rejection; the baseline is
rechecked afterward. This is local script validation, not remote acceptance.

## Completion evidence

- [x] Dedicated remote staging reference and pre-existing Step 1 schema verified.
- [ ] Remote migration history reconciled with the four committed versions after an exact schema comparison and explicit approval.
- [ ] Hosted invite-only settings, exact callback and both email templates verified.
- [ ] Intended owner invited first; sign-in/out and tenant isolation verified remotely.
- [ ] Restricted role provisioned and catalog assertions pass remotely.
- [ ] Owner activated credentials; verified-TLS direct/session connection tested.
- [ ] Worker credential stored in Trigger Staging only.
- [ ] AWS-dependent job execution and artifact acceptance **pending**.

Official references: [CLI migration deployment](https://supabase.com/docs/guides/deployment/database-migrations),
[database connections and custom pooler usernames](https://supabase.com/docs/guides/database/connecting-to-postgres),
[Auth general configuration](https://supabase.com/docs/guides/auth/general-configuration),
[email templates](https://supabase.com/docs/guides/auth/auth-email-templates), and
[redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).
