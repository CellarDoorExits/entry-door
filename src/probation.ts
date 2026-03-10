/**
 * cellar-door-entry — Probationary Status Tracking
 */

import type { ExitMarker } from "cellar-door-exit";
import { createArrivalMarker } from "./arrival.js";
import type { ArrivalMarker, ProbationInfo, CreateArrivalOpts } from "./types.js";

/** Maximum probation duration: 180 days in milliseconds (soft cap). */
export const MAX_PROBATION_DURATION_MS = 180 * 24 * 60 * 60 * 1000; // 15_552_000_000

/** Configuration for creating a probationary arrival. */
export interface ProbationConfig {
  /** Duration in milliseconds. */
  duration: number;
  /** Restrictions during probation. */
  restrictions: string[];
  /** Whether a human/admin review is required before probation ends. */
  reviewRequired: boolean;
}

/**
 * Create an arrival marker with probation metadata.
 */
export function createProbationaryArrival(
  exitMarker: ExitMarker,
  destination: string,
  probation: ProbationConfig,
  opts?: Omit<CreateArrivalOpts, "probation"> & { maxProbationDuration?: number }
): ArrivalMarker {
  const maxDuration = opts?.maxProbationDuration ?? MAX_PROBATION_DURATION_MS;
  if (probation.duration > maxDuration) {
    console.warn(
      `[cellar-door-entry] Probation duration ${probation.duration}ms exceeds soft cap of ${maxDuration}ms (${Math.round(maxDuration / 86400000)} days). Proceeding anyway.`
    );
  }
  const timestamp = opts?.timestamp ?? new Date().toISOString();
  const probationInfo: ProbationInfo = {
    duration: probation.duration,
    restrictions: probation.restrictions,
    reviewRequired: probation.reviewRequired,
    startedAt: timestamp,
  };

  return createArrivalMarker(exitMarker, destination, {
    ...opts,
    timestamp,
    admissionType: "conditional",
    conditions: [
      ...(opts?.conditions ?? []),
      `probation-${probation.duration}ms`,
      ...probation.restrictions.map((r) => `restriction:${r}`),
    ],
    probation: probationInfo,
  });
}

/**
 * Check if probation has elapsed for an arrival marker.
 */
export function isProbationComplete(arrival: ArrivalMarker, now?: Date): boolean {
  if (!arrival.probation) return true; // No probation = complete
  const start = new Date(arrival.probation.startedAt).getTime();
  const currentTime = (now ?? new Date()).getTime();
  return currentTime >= start + arrival.probation.duration;
}
