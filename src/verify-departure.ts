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
export function verifyDepartureJSON(exitMarkerJson: string): { marker: ExitMarker; result: VerificationResult } {
  try {
    const marker = fromJSON(exitMarkerJson);
    const result = verifyDeparture(marker);
    return { marker, result };
  } catch (e) {
    return {
      marker: null as unknown as ExitMarker,
      result: { valid: false, errors: [(e as Error).message] },
    };
  }
}
