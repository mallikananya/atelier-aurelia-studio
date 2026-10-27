# Cloud work deferred

Local development is the active path. None of the items below is required to build,
run, or test the application locally, and none was provisioned or changed by the
local-first simplification.

- **AWS S3:** create and verify the private versioned bucket, Block Public Access,
  bucket-owner enforcement, conditional-write policy, prefix-scoped runtime/signer
  roles, and live storage acceptance. The existing S3-compatible adapter remains the
  production boundary; local development uses MinIO.
- **Hosted Supabase:** finish invited-owner Auth acceptance, custom SMTP/templates,
  restricted worker login activation, TLS/session-pool verification, backup/restore
  policy, and remote migration checks. Local PostgreSQL/Auth/Mailpit use Supabase CLI.
- **Trigger.dev Cloud:** configure restricted runtime secrets, opt into schedules only
  after their backing services are ready, and run browser-close/redeploy,
  retry/cancellation, reconciliation, and exact-version durability acceptance. Local
  development uses the same workflow core through the local runner.
- **Production email:** configure a reviewed transactional provider and domain
  authentication only when hosted invitation/sign-in email is required. Local Auth
  email stays in Mailpit and never reaches real recipients.
- **Web hosting:** choose and approve a production host, secrets, domains, observability,
  budgets, and rollback process. No paid plan or resource may be created without
  explicit approval.
- **Etsy:** OAuth/token storage, listing-package validation, idempotent draft creation,
  upload reconciliation, and controlled live draft acceptance remain later product
  milestones. Automated publishing remains prohibited.

Cloud and local differences are intentional: local URLs use loopback and local
credentials; production requires TLS, managed secrets, externally reachable services,
and provider-specific operational controls. Domain contracts, PostgreSQL migrations,
the BlobStore port, and workflow repository/execution boundaries are shared.
