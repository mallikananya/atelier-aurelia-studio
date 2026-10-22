# Step 1 AWS artifact readiness — live acceptance pending

These are reviewed configuration inputs, not a deployment or evidence that AWS is
ready. AWS provisioning remains blocked by the open support ticket. No Step 2
resources, KMS key, lifecycle cleanup, replication or provisioning script is added.

When AWS becomes available, use a dedicated private **staging general-purpose
bucket**. Replace every literal `ARTIFACT_BUCKET` in policy documents with its
confirmed name; never apply templates containing placeholders. Apply versioning,
all four public access blocks, BucketOwnerEnforced ownership, and SSE-S3 default
encryption from the matching JSON files. Keep every lifecycle rule disabled.
Apply `bucket-policy.json` and preserve its explicit denials.

Attach `worker-policy.json` only to the Trigger.dev artifact worker identity and
`download-policy.json` only to the Vercel server-side download identity. Attach no
broader policies. Neither identity receives deletion, list, ACL, bucket policy,
versioning, lifecycle or encryption administration permissions. `audit-policy.json`
is for a **separate read-only acceptance identity**, never an application runtime.
Check effective IAM permissions and any resource policies before deployment;
these policy templates cannot prove the absence of other grants.

Conditional `If-None-Match` writes and deletion denial together prevent key reuse.
The bucket policy denies writes missing that header even when an IAM grant would
otherwise allow them. It intentionally does not exempt multipart operations: the
existing Step 1 adapter uses single PutObject calls. Copy and multipart workflows
are outside this slice. IAM does not enforce the UUID structure inside `accounts/`;
canonical identity validation remains in the existing storage adapter.

References: [AWS conditional-write enforcement](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes-enforce.html),
[AWS conditional-write semantics](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html),
and [exact-version read permissions](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html).

## Offline checks

Run `node --test tests/aws/*.test.mjs`. These validate policy inputs and the live
suite's opt-in guard. Existing MinIO, unit, database and browser suites remain
unchanged and required; offline checks are not AWS acceptance.

## Dedicated live acceptance (pending)

Only after AWS provisioning and credentials are authorized, provide the following
through a secure local shell or CI secret store, never a committed file or command
argument containing values:

- `AWS_ACCEPTANCE_ENABLED=true`
- `AWS_ACCEPTANCE_BUCKET` exactly equal to `OBJECT_STORAGE_BUCKET`
- `OBJECT_STORAGE_REGION` and `OBJECT_STORAGE_BUCKET`
- Worker `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, optional `AWS_SESSION_TOKEN`
- Dedicated Vercel signer `AWS_ACCEPTANCE_SIGNER_ACCESS_KEY_ID`,
  `AWS_ACCEPTANCE_SIGNER_SECRET_ACCESS_KEY`, optional `AWS_ACCEPTANCE_SIGNER_SESSION_TOKEN`
- Separate read-only `AWS_ACCEPTANCE_AUDIT_ACCESS_KEY_ID`,
  `AWS_ACCEPTANCE_AUDIT_SECRET_ACCESS_KEY`, optional `AWS_ACCEPTANCE_AUDIT_SESSION_TOKEN`

Worker, signer and audit access-key IDs must differ. Use the actual separate
deployment identities; different keys alone do not establish distinct IAM policies.
The signer suite proves version-scoped downloads succeed while writes, both delete
forms, current-version reads and bucket listing fail.

Unset `OBJECT_STORAGE_ENDPOINT`, `AWS_ENDPOINT_URL`, and `AWS_ENDPOINT_URL_S3`;
set path style false or leave it unset. Run
`npx vitest run --config tests/aws/vitest.config.mts`. Missing configuration fails
rather than skips. This command does not read `.env`, configure AWS, or create a
bucket. It does write small random immutable fixtures and intentionally retains
them; there is no runtime cleanup privilege. Negative write/delete probes can
succeed if a policy is broken, causing a failing test; use only the dedicated
staging bucket and acceptance fixture identities.

The suite preserves the six existing MinIO guarantees: verified SHA-256/size and
version-bound private downloads; sequential overwrite rejection (identical and
changed bytes); exactly one concurrent first writer; invalid digest rejection;
denied version deletion and delete markers; and expired signed URL rejection.
It adds read-only bucket configuration/policy/lifecycle inspection, direct
unconditional-write denial, prefix escape denial and bucket enumeration denial.
It does not replace authenticated application/RLS browser acceptance or the final
Trigger.dev-to-Supabase-to-S3 staging run, which remain independently required.
