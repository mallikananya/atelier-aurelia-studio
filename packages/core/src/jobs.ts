export const jobTransitions = {
  queued: ["dispatched", "cancel_requested"],
  dispatched: ["running", "failed", "cancel_requested"],
  running: ["succeeded", "failed", "cancel_requested"],
  failed: ["queued"],
  cancel_requested: ["canceled", "failed"],
  succeeded: [],
  canceled: [],
} as const;

export type JobStatus = keyof typeof jobTransitions;

export function canTransitionJob(from: JobStatus, to: JobStatus): boolean {
  return (jobTransitions[from] as readonly JobStatus[]).includes(to);
}

export function nextJobProgress(currentPercent: number, nextPercent: number): number {
  if (nextPercent < currentPercent) {
    throw new Error("Job progress cannot move backwards.");
  }

  if (!Number.isInteger(nextPercent) || nextPercent < 0 || nextPercent > 100) {
    throw new Error("Job progress must be an integer between 0 and 100.");
  }

  return nextPercent;
}
