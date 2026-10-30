import "server-only";

import { createPlanningPersistence, type PlanningPersistence } from "../../../../../packages/workflows/src/planning-persistence";

let persistence: PlanningPersistence | undefined;
export function getPlanningPersistence(): PlanningPersistence | null {
  if (!process.env.PLANNING_DATABASE_URL) return null;
  try {
    persistence ??= createPlanningPersistence();
    return persistence;
  } catch {
    console.error(JSON.stringify({ event: "planning.database.configuration_invalid" }));
    return null;
  }
}
