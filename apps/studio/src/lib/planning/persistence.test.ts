import { afterEach, describe, expect, it, vi } from "vitest";
const create = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("../../../../../packages/workflows/src/planning-persistence", () => ({ createPlanningPersistence: create }));
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.resetModules(); create.mockReset(); });
describe("server-only planning persistence configuration", () => {
  it("fails closed when dedicated credentials are absent", async () => {
    vi.stubEnv("PLANNING_DATABASE_URL", "");
    const { getPlanningPersistence } = await import("./persistence");
    expect(getPlanningPersistence()).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });
  it("caches a bounded pool without exposing credentials", async () => {
    vi.stubEnv("PLANNING_DATABASE_URL", "test-only");
    const persistence = {};
    create.mockReturnValue(persistence);
    const { getPlanningPersistence } = await import("./persistence");
    expect(getPlanningPersistence()).toBe(persistence);
    expect(getPlanningPersistence()).toBe(persistence);
    expect(create).toHaveBeenCalledOnce();
  });
  it("reports invalid configuration safely and permits correction", async () => {
    vi.stubEnv("PLANNING_DATABASE_URL", "test-only");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    create.mockImplementationOnce(() => { throw new Error("private credential"); }).mockReturnValue({});
    const { getPlanningPersistence } = await import("./persistence");
    expect(getPlanningPersistence()).toBeNull();
    expect(log).toHaveBeenCalledExactlyOnceWith('{"event":"planning.database.configuration_invalid"}');
    expect(getPlanningPersistence()).not.toBeNull();
  });
});
