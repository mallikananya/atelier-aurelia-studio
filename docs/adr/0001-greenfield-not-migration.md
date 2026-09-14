# ADR 0001: Greenfield replacement, behavioral migration only

Status: Accepted

The legacy repository demonstrated valuable safety behavior but coupled product generation to a deterministic planner/template catalog and local filesystem execution.

Decision: this repository is greenfield. Legacy implementation code is not copied wholesale. We recreate selected behavioral contracts and adversarial tests: immutable artifact identity, path/archive safety, exact-byte preflight, approval binding, Etsy idempotency/reconciliation/verification, and mocked provider E2E.

Rejected: treating the legacy repository as a base and incrementally replacing its designer.
