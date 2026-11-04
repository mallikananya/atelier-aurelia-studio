# CE-03C.2.1 — Bounded planning lease renewal

Verified locally on 2026-11-04 against the existing authenticated planning path. `docs/PRD.md` remains authoritative. This milestone changes reservation lifetime and cancellation, not creative contracts or composition.

## Behavior and security

- Admission retains the initial 120-second lease. One controller renews approximately 30 seconds after each completed renewal, across generation, all schema-repair attempts, and saving. Renewal and save never overlap within that controller.
- Every reservation has a database-enforced, immutable deadline of `created_at + 17 minutes`. Renewals extend expiry to the earlier of database time plus 120 seconds or that deadline. Three sequential attempts of up to 300 seconds fit within this bound, subject to the remaining time for application and database overhead.
- The authenticated admission RPC derives the owner from `auth.uid()`. The application generates a separate random holder token; the database stores its SHA-256 hash. Reservation ID alone cannot renew, release, or save. Tokens are not returned to the browser or logged.
- Private writer functions lock the reservation, product, and owner membership in that order, revalidate ownership and expected revision, and check wall-clock expiry after lock waits. Admission retains its owner advisory lock, duplicate identity checks, per-product/per-owner concurrency limits, and rate limits.
- Save checks expiry before and after revision writes. A deferred constraint trigger checks completion at transaction commit; expiry rolls back the revision, product pointer, audit entry, and completion together. Late output cannot revive a reservation. Completed cleanup is a token-validated no-op.
- Browser roles cannot call the private writer functions. Legacy ID-only writer entrypoints and the old admission signature are revoked from application roles. Existing revision/schema/lineage validation remains in place.
- The controller uses monotonic time and database-returned durations, conservatively subtracting request latency. A renewal failure or expiry aborts planning, prevents further repairs and saves, and stops timers. Cleanup is best effort; database expiry remains authoritative if cleanup fails.
- The optional `AbortSignal` now travels through `planProduct` and provider adapters to HTTP fetch and response reads. Noncooperative provider promises are detached safely and their late results ignored. Per-attempt inference timeout and the three-attempt maximum are unchanged.

## Migration and rollout

Forward-only migration: `supabase/migrations/202611030001_planning_lease_renewal.sql`. Applied successfully to the existing local database without resets, volume changes, or rewriting product revisions. Historical reservations receive a deadline; their missing holder hashes intentionally prevent reuse.

For another environment, pause new planning admissions and drain active planning before applying this migration and deploying the matching application. The old application cannot use the revoked ID-only signatures. Do not roll back by restoring those grants. Existing unrelated infrastructure and data are preserved.

The dedicated database adapter retains bounded connection/statement timeouts and adds a 35-second client query timeout. Errors roll back transactions; failed rollback destroys the connection. An ambiguous save response is never automatically retried.

## Verification

- Full coverage command passed: 414 Vitest tests across 30 files, plus 53 root Node tests and 17 workspace Node tests. Vitest coverage: 97.62% statements, 95.48% branches, 94.87% functions, 98.77% lines; configured 80% gates pass.
- Database pgTAP suite: 305 assertions across nine files passed. Covers grants, holder fencing, immutable deadline, expired/cancelled reservations, ownership, concurrency and admission limits.
- Workflow integration suite: 22 tests across three files passed, plus the separate long-running acceptance test below. The real database planning race subset contains 13 passing tests. Includes expiry while waiting on product/membership locks, hard-deadline expiry during lock waits, renewal versus completed save, revoked ownership, stale expected revision, and delayed-commit rollback without stale revision/audit/pointer writes.
- Authenticated long-running integration: a controlled provider waited 125 seconds; the real service, authenticated admission RPC, least-privilege writer, and database saved one strict valid planning revision after the original 120-second lease. At least five renewals occurred. Replay was rejected and history remained exactly two revisions (initial plus generated). Test duration: 125.62 seconds. This uses a declared test fixture, not Qwen3 inference or evidence of AI design quality.
- Controlled-clock service/controller tests cover three sequential 299-second attempts (897 seconds total), multiple renewals, hard deadline, nonoverlap, clock skew, cancellation, failed renewals, database failures, cleanup, and no save from late responses.
- Planning browser suite: seven tests passed. Lint, typecheck, architecture guardrails, and production build passed. Production dependency audit: zero vulnerabilities. The previously deferred moderate development-tooling advisories are unchanged; no dependency upgrades or suppressions were introduced.

## Remaining limitations

PRD §9 private durable-result checkpoints and complete restart recovery remain outstanding. A process crash can lose in-memory generated output; the lease eventually expires, but this milestone does not recover that output. A lost commit response remains an uncertain outcome requiring history inspection rather than blind retry.

Aborting HTTP prevents this application from consuming or saving late output; it does not prove that Ollama or another provider immediately stops model computation. No expensive local inference was repeated to test lease mechanics. Process suspension or prolonged database unavailability fails closed and may discard otherwise useful output. The 17-minute hard deadline is an upper bound, not a guarantee that every three-attempt run can finish.

CE-03C.2.1 does not implement CE-03C.3, AI-authored page composition, or durable result recovery. CE-03A contracts, CE-03B rendering, owner review, and Etsy draft-only approval remain unchanged.
