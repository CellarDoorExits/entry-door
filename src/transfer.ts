/**
 * cellar-door-entry — Passage Verification
 *
 * The PASSAGE primitive: end-to-end verification of EXIT → ENTRY.
 *
 * NOTE: Exported names (`TransferRecord`, `verifyTransfer`, `transferTime`)
 * are kept for backward compatibility. They will be renamed to
 * `PassageRecord`, `verifyPassage`, and `passageTime` in v0.2.0.
 */

import { verifyMarker, type ExitMarker } from "cellar-door-exit";
import { verifyArrivalMarker } from "./sign.js";
import { verifyContinuity } from "./continuity.js";
import type { ArrivalMarker, ContinuityResult } from "./types.js";

/** A complete Passage record linking EXIT and ENTRY. (Rename to PassageRecord in v0.2.0) */
export interface TransferRecord {
  exit: ExitMarker;
  arrival: ArrivalMarker;
  continuity: ContinuityResult;
  /** Time between departure and arrival in milliseconds. */
  transferTime: number;
  /** Whether the full Passage is verified. */
  verified: boolean;
  /** Errors from any stage of verification. */
  errors: string[];
}

/**
 * Verify a complete Passage: exit signature, arrival signature, and continuity.
 * (Rename to verifyPassage in v0.2.0)
 */
export function verifyTransfer(exitMarker: ExitMarker, arrivalMarker: ArrivalMarker): TransferRecord {
  const errors: string[] = [];

  // 1. Verify EXIT marker
  const exitResult = verifyMarker(exitMarker);
  if (!exitResult.valid) {
    errors.push(...exitResult.errors.map((e: string) => `EXIT: ${e}`));
  }

  // 2. Verify ARRIVAL marker
  const arrivalResult = verifyArrivalMarker(arrivalMarker);
  if (!arrivalResult.valid) {
    errors.push(...arrivalResult.errors.map((e) => `ARRIVAL: ${e}`));
  }

  // 3. Verify continuity
  const continuity = verifyContinuity(exitMarker, arrivalMarker);
  if (!continuity.valid) {
    errors.push(...continuity.errors.map((e) => `CONTINUITY: ${e}`));
  }

  // 4. Compute passage time
  const exitTime = new Date(exitMarker.timestamp).getTime();
  const arrivalTime = new Date(arrivalMarker.timestamp).getTime();
  const transferTime = arrivalTime - exitTime;

  return {
    exit: exitMarker,
    arrival: arrivalMarker,
    continuity,
    transferTime,
    verified: errors.length === 0,
    errors,
  };
}
