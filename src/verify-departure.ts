/**
 * cellar-door-entry — EXIT Marker Verification
 */

import { verifyMarker, fromJSON, type ExitMarker } from "cellar-door-exit";
import type { VerificationResult } from "./types.js";

/**
 * Verify an EXIT marker (object form). Returns structured result.
 */
export function verifyDeparture(exitMarker: ExitMarker): VerificationResult {
  const result = verifyMarker(exitMarker);
  return { valid: result.valid, errors: [...result.errors] };
}

/**
 * Parse and verify an EXIT marker from JSON string.
 */
export type VerifyDepartureJSONResult =
  | { marker: ExitMarker; result: VerificationResult; parsed: true }
  | { marker: null; result: VerificationResult; parsed: false };

export function verifyDepartureJSON(exitMarkerJson: string): VerifyDepartureJSONResult {
  try {
    const marker = fromJSON(exitMarkerJson);
    const result = verifyDeparture(marker);
    return { marker, result, parsed: true };
  } catch (e) {
    return {
      marker: null,
      result: { valid: false, errors: [(e as Error).message] },
      parsed: false,
    };
  }
}
