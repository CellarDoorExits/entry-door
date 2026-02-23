/**
 * cellar-door-entry — Transfer Verification
 *
 * The TRANSFER primitive: end-to-end verification of EXIT → ENTRY.
 */

import { verifyMarker, type ExitMarker } from "cellar-door-exit";
import { verifyArrivalMarker } from "./sign.js";
import { verifyContinuity } from "./continuity.js";
import type { ArrivalMarker, ContinuityResult } from "./types.js";

/** A complete transfer record linking EXIT and ENTRY. */
export interface TransferRecord {
  exit: ExitMarker;
  arrival: ArrivalMarker;
  continuity: ContinuityResult;
  /** Time between departure and arrival in milliseconds. */
  transferTime: number;
  /** Whether the full transfer is verified. */
  verified: boolean;
  /** Errors from any stage of verification. */
  errors: string[];
}

/**
 * Verify a complete transfer: exit signature, arrival signature, and continuity.
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

  // 4. Compute transfer time
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
