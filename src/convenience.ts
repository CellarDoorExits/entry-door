/**
 * cellar-door-entry — Convenience Methods
 */

import {
  fromJSON,
  generateKeyPair,
  didFromPublicKey,
  generateP256KeyPair,
  didFromP256PublicKey,
  type ExitMarker,
} from "cellar-door-exit";
import { createArrivalMarker } from "./arrival.js";
import { signArrivalMarker, type SignatureAlgorithm } from "./sign.js";
import { verifyContinuity } from "./continuity.js";
import type { ArrivalMarker, CreateArrivalOpts } from "./types.js";

export interface QuickEntryOpts extends CreateArrivalOpts {
  /** Signature algorithm to use. @default "Ed25519" */
  algorithm?: SignatureAlgorithm;
}

export interface QuickEntryResult {
  arrivalMarker: ArrivalMarker;
  exitMarker: ExitMarker;
  continuity: { valid: boolean; errors: string[] };
}

/**
 * One-shot: parse EXIT marker JSON, verify it, create a signed arrival marker,
 * and verify continuity. Uses a fresh keypair for signing the arrival.
 *
 * **⚠️ WARNING:** This function generates **ephemeral keys** that exist only in
 * memory for the duration of the call. It is intended for **testing, demos, and
 * prototyping only**. Production deployments should manage their own long-lived
 * keypairs and call `signArrivalMarker()` directly.
 *
 * @param exitMarkerJson - JSON string of the EXIT marker
 * @param destination - Destination platform identifier
 * @param opts - Optional overrides including algorithm selection
 */
export function quickEntry(
  exitMarkerJson: string,
  destination: string,
  opts?: QuickEntryOpts
): QuickEntryResult {
  const algorithm = opts?.algorithm ?? "Ed25519";
  const exitMarker = fromJSON(exitMarkerJson);
  const arrival = createArrivalMarker(exitMarker, destination, opts);

  // Sign with a fresh keypair (destination's key)
  let publicKey: Uint8Array;
  let privateKey: Uint8Array;

  if (algorithm === "P-256") {
    const kp = generateP256KeyPair();
    publicKey = kp.publicKey;
    privateKey = kp.privateKey;
  } else {
    const kp = generateKeyPair();
    publicKey = kp.publicKey;
    privateKey = kp.privateKey;
  }

  const signed = signArrivalMarker(arrival, privateKey, publicKey, algorithm);

  const continuity = verifyContinuity(exitMarker, signed);

  return {
    arrivalMarker: signed,
    exitMarker,
    continuity,
  };
}

/**
 * Convenience alias: create a P-256 ENTRY marker in one call.
 *
 * **⚠️ WARNING:** Generates ephemeral keys for testing only.
 * @see quickEntry for full documentation.
 *
 * @param exitMarkerJson - JSON string of the EXIT marker
 * @param destination - Destination platform identifier
 * @param opts - Optional overrides (algorithm is forced to "P-256")
 */
export function quickEntryP256(
  exitMarkerJson: string,
  destination: string,
  opts?: Omit<QuickEntryOpts, "algorithm">
): QuickEntryResult {
  return quickEntry(exitMarkerJson, destination, { ...opts, algorithm: "P-256" });
}
