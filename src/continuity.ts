/**
 * cellar-door-entry — Continuity Verification
 *
 * Verifies that an arrival marker correctly continues from a departure marker.
 */

import { verifyMarker, type ExitMarker } from "cellar-door-exit";
import type { ArrivalMarker, ContinuityResult } from "./types.js";

/**
 * Verify continuity between an EXIT marker and an ARRIVAL marker.
 *
 * Checks:
 * 1. The arrival references the correct departure (by ID)
 * 2. The subject DID matches
 * 3. Timestamps are sequential (arrival after departure)
 * 4. The departure marker is cryptographically valid
 */
export function verifyContinuity(
  exitMarker: ExitMarker,
  arrivalMarker: ArrivalMarker
): ContinuityResult {
  const errors: string[] = [];

  // 1. Departure reference matches
  if (arrivalMarker.departureRef !== exitMarker.id) {
    errors.push(
      `Departure reference mismatch: arrival references "${arrivalMarker.departureRef}" but exit marker has id "${exitMarker.id}"`
    );
  }

  // 2. Subject DID matches
  if (arrivalMarker.subject !== exitMarker.subject) {
    errors.push(
      `Subject mismatch: arrival subject "${arrivalMarker.subject}" does not match departure subject "${exitMarker.subject}"`
    );
  }

  // 3. Origin matches
  if (arrivalMarker.departureOrigin !== exitMarker.origin) {
    errors.push(
      `Origin mismatch: arrival claims origin "${arrivalMarker.departureOrigin}" but exit marker has origin "${exitMarker.origin}"`
    );
  }

  // 4. Timestamps are sequential
  const exitTime = new Date(exitMarker.timestamp).getTime();
  const arrivalTime = new Date(arrivalMarker.timestamp).getTime();
  if (!isNaN(exitTime) && !isNaN(arrivalTime) && arrivalTime < exitTime) {
    errors.push(
      `Temporal violation: arrival timestamp (${arrivalMarker.timestamp}) is before departure timestamp (${exitMarker.timestamp})`
    );
  }

  // 5. Departure marker is cryptographically valid
  const exitVerification = verifyMarker(exitMarker);
  if (!exitVerification.valid) {
    errors.push(`Departure marker is invalid: ${exitVerification.errors.join("; ")}`);
  }

  return { valid: errors.length === 0, errors };
}
