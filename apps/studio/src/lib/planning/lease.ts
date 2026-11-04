import type { PlanningLease, PlanningPersistence } from "../../../../../packages/workflows/src/planning-persistence";

const RENEW_MS = 30_000;
function expired() {
  return Object.assign(new Error("Planning reservation expired"), { code: "42501" });
}

/** One controller spans all provider attempts and the final fenced write. */
export async function startPlanningLease(persistence: PlanningPersistence, lease: PlanningLease) {
  const abort = new AbortController();
  let heartbeat: ReturnType<typeof setTimeout> | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<void> | undefined;
  let stopped = false;
  let saving = false;
  let completed = false;
  let leaseEnd = 0;
  let hardDeadline: number | undefined;

  function fail(error: unknown) {
    if (!abort.signal.aborted) abort.abort(error);
    clearTimeout(heartbeat);
  }
  function check() {
    if (abort.signal.aborted) throw abort.signal.reason;
    if (stopped || completed || performance.now() >= leaseEnd) {
      fail(expired());
      throw abort.signal.reason;
    }
  }
  async function renew() {
    const started = performance.now();
    const result = await persistence.renew(lease);
    if (stopped || abort.signal.aborted) return;
    const serverNow = Date.parse(result.serverNow);
    const deadline = Date.parse(result.hardDeadline);
    const expiresAt = Date.parse(result.expiresAt);
    if (![serverNow, deadline, expiresAt].every(Number.isFinite)
      || expiresAt > deadline || (hardDeadline !== undefined && deadline !== hardDeadline)) throw expired();
    hardDeadline = deadline;
    // Subtract the complete request duration, conservatively including network/lock time.
    // Wall-clock skew between the app and database cannot extend the local lease.
    leaseEnd = started + Math.min(expiresAt - serverNow, deadline - serverNow);
    check();
    clearTimeout(expiry);
    expiry = setTimeout(() => fail(expired()), Math.max(0, leaseEnd - performance.now()));
  }
  function schedule() {
    if (stopped || saving || abort.signal.aborted) return;
    heartbeat = setTimeout(() => {
      pending = renew().catch(fail).finally(() => { pending = undefined; schedule(); });
    }, RENEW_MS);
  }
  try { await renew(); } catch (error) { fail(error); throw error; }
  schedule();
  return {
    signal: abort.signal,
    check,
    async save(envelope: unknown) {
      check();
      if (saving) throw expired();
      saving = true;
      clearTimeout(heartbeat);
      await pending;
      check();
      // Serialize heartbeat and save so a successful append is never mistaken for lease loss.
      try {
        await renew();
        check();
        const rows = await persistence.save(lease, envelope);
        // The database has independently fenced the write at its actual completion time.
        completed = true;
        clearTimeout(expiry);
        return rows;
      } catch (error) { fail(error); throw error; }
    },
    async stop() {
      stopped = true;
      clearTimeout(heartbeat);
      clearTimeout(expiry);
      // Persistence has bounded connect/query timeouts; never orphan a renewal during cleanup.
      await pending;
    },
  };
}
