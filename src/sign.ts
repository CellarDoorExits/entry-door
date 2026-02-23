/**
 * cellar-door-entry — Signing and Verification for Arrival Markers
 */

import { sign, verify, didFromPublicKey, publicKeyFromDid } from "cellar-door-exit";
import { canonicalize } from "./arrival.js";
import type { ArrivalMarker, ArrivalProof } from "./types.js";

/**
 * Sign an arrival marker with Ed25519. Returns a new marker with proof attached.
 */
export function signArrivalMarker(
  marker: ArrivalMarker,
  privateKey: Uint8Array,
  publicKey: Uint8Array
): ArrivalMarker {
  const did = didFromPublicKey(publicKey);
  const { proof: _proof, ...rest } = marker;
  const canonical = canonicalize(rest);
  const data = new TextEncoder().encode(canonical);
  const signature = sign(data, privateKey);
  const proofValue = btoa(String.fromCharCode(...signature));

  const proof: ArrivalProof = {
    type: "Ed25519Signature2020",
    created: new Date().toISOString(),
    verificationMethod: did,
    proofValue,
  };

  return { ...marker, proof };
}

export interface ArrivalVerificationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Verify the signature on an arrival marker.
 */
export function verifyArrivalMarker(marker: ArrivalMarker): ArrivalVerificationResult {
  const errors: string[] = [];

  if (!marker.proof) {
    return { valid: false, errors: ["Missing proof"] };
  }

  if (marker.proof.type !== "Ed25519Signature2020") {
    return { valid: false, errors: [`Unsupported proof type: ${marker.proof.type}`] };
  }

  if (!marker.proof.verificationMethod || !marker.proof.proofValue) {
    return { valid: false, errors: ["Incomplete proof"] };
  }

  try {
    const publicKey = publicKeyFromDid(marker.proof.verificationMethod);
    const { proof: _proof, ...rest } = marker;
    const canonical = canonicalize(rest);
    const data = new TextEncoder().encode(canonical);
    const sigStr = atob(marker.proof.proofValue);
    const signature = new Uint8Array(sigStr.length);
    for (let i = 0; i < sigStr.length; i++) signature[i] = sigStr.charCodeAt(i);

    if (!verify(data, signature, publicKey)) {
      errors.push("Signature verification failed");
    }
  } catch (e) {
    errors.push(`Verification error: ${(e as Error).message}`);
  }

  return { valid: errors.length === 0, errors };
}
