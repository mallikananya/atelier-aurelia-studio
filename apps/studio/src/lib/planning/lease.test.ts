import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlanningPersistence } from "../../../../../packages/workflows/src/planning-persistence";
import { startPlanningLease } from "./lease";

const lease = { reservationId: "50000000-0000-4000-8000-000000000001", holderToken: "50000000-0000-4000-8000-000000000002" };
function setup() {
  const hard = Date.now() + 1_020_000;
  const persistence: PlanningPersistence = {
    renew: vi.fn(async () => ({ serverNow: new Date().toISOString(),
      expiresAt: new Date(Math.min(Date.now() + 120_000, hard)).toISOString(), hardDeadline: new Date(hard).toISOString() })),
    save: vi.fn(async () => []), release: vi.fn(async () => undefined), close: vi.fn(async () => undefined),
  };
  return persistence;
}
afterEach(() => vi.useRealTimers());
describe("bounded planning lease", () => {
  it("keeps three sequential near-five-minute attempts alive and saves after the original lease", async () => {
    vi.useFakeTimers();
    const persistence = setup();
    const controller = await startPlanningLease(persistence, lease);
    for (let attempt = 0; attempt < 3; attempt++) {
      await vi.advanceTimersByTimeAsync(299_000);
      controller.check();
    }
    await controller.save({});
    expect(persistence.renew).toHaveBeenCalledTimes(31);
    expect(persistence.save).toHaveBeenCalledExactlyOnceWith(lease, {});
    await vi.advanceTimersByTimeAsync(200_000);
    expect(controller.signal.aborted).toBe(false);
    await controller.stop();
  });
  it("aborts on renewal failure and prevents any subsequent save", async () => {
    vi.useFakeTimers();
    const persistence = setup();
    const controller = await startPlanningLease(persistence, lease);
    vi.mocked(persistence.renew).mockRejectedValue(new Error("database unavailable"));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(controller.signal.aborted).toBe(true);
    await expect(controller.save({})).rejects.toThrow("database unavailable");
    expect(persistence.save).not.toHaveBeenCalled();
    await controller.stop();
  });
  it("does not overlap renewals; expiry cancels a blocked renewal and stop joins it", async () => {
    vi.useFakeTimers();
    const persistence = setup();
    const controller = await startPlanningLease(persistence, lease);
    let reject!: (error: Error) => void;
    vi.mocked(persistence.renew).mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
    await vi.advanceTimersByTimeAsync(125_000);
    expect(persistence.renew).toHaveBeenCalledTimes(2);
    expect(controller.signal.aborted).toBe(true);
    let stopped = false;
    const stopping = controller.stop().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    reject(new Error("query timeout"));
    await stopping;
    expect(stopped).toBe(true);
  });
  it("rejects hard-deadline expiry and never resurrects the lease", async () => {
    vi.useFakeTimers();
    const persistence = setup();
    const controller = await startPlanningLease(persistence, lease);
    await vi.advanceTimersByTimeAsync(1_020_000);
    expect(controller.signal.aborted).toBe(true);
    await expect(controller.save({})).rejects.toMatchObject({ code: "42501" });
    expect(persistence.save).not.toHaveBeenCalled();
    await controller.stop();
  });
  it("joins an in-flight renewal before the final save and prevents duplicate saves", async () => {
    vi.useFakeTimers();
    const persistence = setup();
    const controller = await startPlanningLease(persistence, lease);
    const original = persistence.renew;
    let resume!: () => void;
    vi.mocked(persistence.renew).mockImplementationOnce(() => new Promise(resolve => {
      resume = () => resolve({ serverNow: new Date().toISOString(), expiresAt: new Date(Date.now() + 120_000).toISOString(),
        hardDeadline: new Date(Date.now() + 990_000).toISOString() });
    }));
    await vi.advanceTimersByTimeAsync(30_000);
    const saving = controller.save({});
    expect(persistence.save).not.toHaveBeenCalled();
    resume();
    await saving;
    await expect(controller.save({})).rejects.toThrow();
    expect(original).toHaveBeenCalledTimes(3);
    await controller.stop();
  });
});

it("uses database remaining time despite application wall-clock skew", async () => {
  vi.useFakeTimers();
  const persistence = setup();
  vi.mocked(persistence.renew).mockImplementation(async () => ({
    serverNow: "2020-01-01T00:00:00Z", expiresAt: "2020-01-01T00:02:00Z", hardDeadline: "2020-01-01T00:17:00Z",
  }));
  const controller = await startPlanningLease(persistence, lease);
  controller.check();
  await controller.stop();
});
it("rejects a changed immutable deadline and an invalid initial deadline", async () => {
  vi.useFakeTimers();
  const persistence = setup();
  const controller = await startPlanningLease(persistence, lease);
  vi.mocked(persistence.renew).mockResolvedValue({
    serverNow: new Date().toISOString(), expiresAt: new Date(Date.now() + 120_000).toISOString(),
    hardDeadline: new Date(Date.now() + 1_021_000).toISOString(),
  });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(controller.signal.aborted).toBe(true);
  await controller.stop();
  vi.mocked(persistence.renew).mockResolvedValue({ serverNow: "invalid", expiresAt: "invalid", hardDeadline: "invalid" });
  await expect(startPlanningLease(persistence, lease)).rejects.toMatchObject({ code: "42501" });
});
it("never retries an ambiguous save and cancels its controller", async () => {
  vi.useFakeTimers();
  const persistence = setup();
  const controller = await startPlanningLease(persistence, lease);
  vi.mocked(persistence.save).mockRejectedValue(new Error("connection lost"));
  await expect(controller.save({})).rejects.toThrow("connection lost");
  expect(controller.signal.aborted).toBe(true);
  await expect(controller.save({})).rejects.toThrow("connection lost");
  expect(persistence.save).toHaveBeenCalledTimes(1);
  await controller.stop();
});
it("rejects saves after stop and drops the result of a renewal that finishes during cleanup", async () => {
  vi.useFakeTimers();
  const persistence = setup();
  const controller = await startPlanningLease(persistence, lease);
  let resume!: (value: Awaited<ReturnType<PlanningPersistence["renew"]>>) => void;
  vi.mocked(persistence.renew).mockImplementation(() => new Promise(resolve => { resume = resolve; }));
  await vi.advanceTimersByTimeAsync(30_000);
  const stopping = controller.stop();
  resume({ serverNow: new Date().toISOString(), expiresAt: new Date(Date.now() + 120_000).toISOString(),
    hardDeadline: new Date(Date.now() + 990_000).toISOString() });
  await stopping;
  await expect(controller.save({})).rejects.toMatchObject({ code: "42501" });
  expect(persistence.save).not.toHaveBeenCalled();
});
