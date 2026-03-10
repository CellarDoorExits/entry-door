/**
 * cellar-door-entry — Convenience Methods
 */

import {
  fromJSON,
  generateKeyPair,
  generateP256KeyPair,
  type ExitMarker,
} from "cellar-door-exit";
import { admit, type AdmitOpts, type AdmitResult, type CounterSignMeaning } from "./admit.js";
import { CAUTIOUS, type BuiltPolicy } from "./policy-builder.js";
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

  // Emit runtime warning about ephemeral keys (ADV-003)
  if (typeof console !== "undefined" && console.warn) {
    console.warn(
      "[cellar-door-entry] quickEntry() uses an ephemeral keypair that is discarded after signing. " +
      "The arrival marker cannot be revoked or updated later. " +
      "For production, use createArrivalMarker() + signArrivalMarker() with a persistent key."
    );
  }

  // Sign with a fresh ephemeral keypair (destination's key)
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
export interface QuickAdmitOpts {
  /** Platform identity. If omitted, an ephemeral keypair is generated. */
  platformIdentity?: { privateKey: Uint8Array; publicKey: Uint8Array };
  /** Policy. Defaults to CAUTIOUS. */
  policy?: BuiltPolicy;
  /** Counter-sign meaning. */
  counterSignMeaning?: CounterSignMeaning;
  /** Destination platform. */
  destination?: string;
  /** Whether to counter-sign. Defaults to true. */
  counterSign?: boolean;
  /** Subject DID for minting (required when exitMarker is null). */
  mintingSubject?: string;
  /** Justification for minting. */
  mintingJustification?: string;
}

/**
 * One-shot admit ceremony with sensible defaults.
 *
 * Works in three modes:
 * 1. With exit marker + counter-sign (default when marker provided)
 * 2. With exit marker, no counter-sign
 * 3. No exit marker — minting
 *
 * Generates ephemeral platform identity if none provided.
 */
export async function quickAdmit(
  exitMarker?: ExitMarker | string | null,
  opts?: QuickAdmitOpts
): Promise<AdmitResult> {
  let marker: ExitMarker | null = null;
  if (typeof exitMarker === "string") {
    marker = fromJSON(exitMarker);
  } else if (exitMarker) {
    marker = exitMarker;
  }

  const platformIdentity = opts?.platformIdentity ?? (() => {
    if (typeof console !== "undefined" && console.warn) {
      console.warn(
        "[cellar-door-entry] quickAdmit() is generating an ephemeral keypair. " +
        "Counter-signatures and arrival proofs will reference an unverifiable DID. " +
        "For production, pass platformIdentity with persistent keys."
      );
    }
    const kp = generateKeyPair();
    return { privateKey: kp.privateKey, publicKey: kp.publicKey };
  })();

  return admit(marker, {
    platformIdentity,
    policy: opts?.policy ?? CAUTIOUS,
    counterSignMeaning: opts?.counterSignMeaning ?? "receipt_only",
    destination: opts?.destination ?? "https://destination.example.com",
    counterSign: opts?.counterSign,
    mintingSubject: opts?.mintingSubject,
    mintingJustification: opts?.mintingJustification,
  });
}

export function quickEntryP256(
  exitMarkerJson: string,
  destination: string,
  opts?: Omit<QuickEntryOpts, "algorithm">
): QuickEntryResult {
  return quickEntry(exitMarkerJson, destination, { ...opts, algorithm: "P-256" });
}
