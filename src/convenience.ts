/**
 * cellar-door-entry — Convenience Methods
 */

import { fromJSON, generateKeyPair, didFromPublicKey, type ExitMarker } from "cellar-door-exit";
import { createArrivalMarker } from "./arrival.js";
import { signArrivalMarker } from "./sign.js";
import { verifyContinuity } from "./continuity.js";
import type { ArrivalMarker, CreateArrivalOpts } from "./types.js";

export interface QuickEntryResult {
  arrivalMarker: ArrivalMarker;
  exitMarker: ExitMarker;
  continuity: { valid: boolean; errors: string[] };
}

/**
 * One-shot: parse EXIT marker JSON, verify it, create a signed arrival marker,
 * and verify continuity. Uses a fresh keypair for signing the arrival.
 */
export function quickEntry(
  exitMarkerJson: string,
  destination: string,
  opts?: CreateArrivalOpts
): QuickEntryResult {
  const exitMarker = fromJSON(exitMarkerJson);
  const arrival = createArrivalMarker(exitMarker, destination, opts);

  // Sign with a fresh keypair (destination's key)
  const { publicKey, privateKey } = generateKeyPair();
  const signed = signArrivalMarker(arrival, privateKey, publicKey);

  const continuity = verifyContinuity(exitMarker, signed);

  return {
    arrivalMarker: signed,
    exitMarker,
    continuity,
  };
}
