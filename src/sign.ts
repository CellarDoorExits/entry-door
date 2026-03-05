/**
 * cellar-door-entry — Signing and Verification for Arrival Markers
 *
 * Supports Ed25519 and P-256 (ECDSA) signature algorithms, mirroring
 * the algorithm agility in cellar-door-exit.
 */

import {
  sign,
  verify,
  didFromPublicKey,
  publicKeyFromDid,
  signP256,
  verifyP256,
  didFromP256PublicKey,
  publicKeyFromP256Did,
  algorithmFromDid,
} from "cellar-door-exit";
import { canonicalize } from "./arrival.js";
import type { ArrivalMarker, ArrivalProof, ArrivalProofType } from "./types.js";

/** Signature algorithm identifiers for ENTRY markers. */
export type SignatureAlgorithm = "Ed25519" | "P-256";

/** Domain separation prefix — prevents cross-protocol replay attacks between EXIT and ENTRY markers. */
const DOMAIN_PREFIX = "entry-marker-v1.0:";

/**
 * Sign an arrival marker. Returns a new marker with proof attached.
 *
 * @param marker - The unsigned arrival marker
 * @param privateKey - Private key bytes
 * @param publicKey - Public key bytes
 * @param algorithm - Signature algorithm (default: "Ed25519")
 */
export function signArrivalMarker(
  marker: ArrivalMarker,
  privateKey: Uint8Array,
  publicKey: Uint8Array,
  algorithm: SignatureAlgorithm = "Ed25519"
): ArrivalMarker {
  const { proof: _proof, ...rest } = marker;
  const canonical = canonicalize(rest);
  const data = new TextEncoder().encode(DOMAIN_PREFIX + canonical);

  let did: string;
  let signature: Uint8Array;
  let proofType: ArrivalProofType;

  if (algorithm === "P-256") {
    did = didFromP256PublicKey(publicKey);
    const sig = signP256(data, privateKey);
    signature = new Uint8Array(sig);
    proofType = "EcdsaP256Signature2019";
  } else {
    did = didFromPublicKey(publicKey);
    signature = sign(data, privateKey);
    proofType = "Ed25519Signature2020";
  }

  const proofValue = btoa(String.fromCharCode(...signature));

  const proof: ArrivalProof = {
    type: proofType,
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
 * Supports both Ed25519 and P-256 proof types.
 */
export function verifyArrivalMarker(marker: ArrivalMarker): ArrivalVerificationResult {
  const errors: string[] = [];

  if (!marker.proof) {
    return { valid: false, errors: ["Missing proof"] };
  }

  const supportedTypes: ArrivalProofType[] = ["Ed25519Signature2020", "EcdsaP256Signature2019"];
  if (!supportedTypes.includes(marker.proof.type as ArrivalProofType)) {
    return { valid: false, errors: [`Unsupported proof type: ${marker.proof.type}`] };
  }

  if (!marker.proof.verificationMethod || !marker.proof.proofValue) {
    return { valid: false, errors: ["Incomplete proof"] };
  }

  try {
    const did = marker.proof.verificationMethod;
    const alg = algorithmFromDid(did);
    const publicKey = alg === "P-256" ? publicKeyFromP256Did(did) : publicKeyFromDid(did);

    const { proof: _proof, ...rest } = marker;
    const canonical = canonicalize(rest);
    const data = new TextEncoder().encode(DOMAIN_PREFIX + canonical);
    const sigStr = atob(marker.proof.proofValue);
    const signature = new Uint8Array(sigStr.length);
    for (let i = 0; i < sigStr.length; i++) signature[i] = sigStr.charCodeAt(i);

    const valid = alg === "P-256"
      ? verifyP256(data, signature, publicKey)
      : verify(data, signature, publicKey);

    if (!valid) {
      errors.push("Signature verification failed");
    }
  } catch (e) {
    errors.push(`Verification error: ${(e as Error).message}`);
  }

  return { valid: errors.length === 0, errors };
}
