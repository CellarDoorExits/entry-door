/**
 * cellar-door-entry — Revocation
 *
 * Revoke arrivals after the fact (e.g., fraud discovered, policy violation).
 */

import {
  sign, verify, didFromPublicKey, publicKeyFromDid,
  signP256, verifyP256, didFromP256PublicKey, publicKeyFromP256Did,
  algorithmFromDid,
} from "cellar-door-exit";
import { canonicalize } from "./arrival.js";
import type { ArrivalMarker } from "./types.js";

/** Signature algorithm for revocation markers. */
export type RevocationAlgorithm = "Ed25519" | "P-256";

const DOMAIN_PREFIX = "entry-marker-v1.0:";

/** A signed revocation marker. */
export interface RevocationMarker {
  type: "RevocationMarker";
  /** ID of the arrival marker being revoked. */
  arrivalRef: string;
  /** Subject of the revoked arrival. */
  subject: string;
  /** DID of the revoking authority (must be the destination platform that signed the arrival). */
  authority: string;
  /** Reason for revocation. */
  reason: string;
  /** When the revocation was issued (ISO 8601 UTC). */
  timestamp: string;
  /** Proof — signed by the revoking authority. */
  proof: {
    type: "Ed25519Signature2020" | "EcdsaP256Signature2019";
    created: string;
    verificationMethod: string;
    proofValue: string;
  };
}

/**
 * Create a signed revocation marker for an arrival.
 * The revoker's public key must match the arrival marker's destination signer (proof.verificationMethod).
 */
export function createRevocationMarker(
  arrivalMarker: ArrivalMarker,
  reason: string,
  privateKey: Uint8Array,
  publicKey: Uint8Array,
  algorithm: RevocationAlgorithm = "Ed25519"
): RevocationMarker {
  const did = algorithm === "P-256"
    ? didFromP256PublicKey(publicKey)
    : didFromPublicKey(publicKey);

  // Verify that the revoker is the destination platform that signed the arrival
  if (arrivalMarker.proof?.verificationMethod && arrivalMarker.proof.verificationMethod !== did) {
    throw new Error(
      `Authority mismatch: revoker DID ${did} does not match arrival signer ${arrivalMarker.proof.verificationMethod}. Only the destination platform that signed the arrival can revoke it.`
    );
  }

  const body = {
    type: "RevocationMarker" as const,
    arrivalRef: arrivalMarker.id,
    subject: arrivalMarker.subject,
    authority: did,
    reason,
    timestamp: new Date().toISOString(),
  };
  const canonical = canonicalize(body);
  const data = new TextEncoder().encode(DOMAIN_PREFIX + canonical);
  const signature = algorithm === "P-256"
    ? signP256(data, privateKey)
    : sign(data, privateKey);
  const proofValue = btoa(String.fromCharCode(...signature));
  const proofType = algorithm === "P-256" ? "EcdsaP256Signature2019" as const : "Ed25519Signature2020" as const;

  return {
    ...body,
    proof: {
      type: proofType,
      created: new Date().toISOString(),
      verificationMethod: did,
      proofValue,
    },
  };
}

/**
 * Verify a revocation marker's signature and (optionally) its authority against an arrival marker.
 */
export function verifyRevocationMarker(
  marker: RevocationMarker,
  arrivalMarker?: ArrivalMarker
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!marker.proof?.proofValue) {
    return { valid: false, errors: ["Missing proof"] };
  }

  // Check authority matches the arrival signer if arrival marker is provided
  if (arrivalMarker?.proof?.verificationMethod) {
    if (marker.authority !== arrivalMarker.proof.verificationMethod) {
      errors.push(
        `Authority mismatch: revocation authority ${marker.authority} does not match arrival signer ${arrivalMarker.proof.verificationMethod}`
      );
    }
  }

  // Check that proof signer matches claimed authority
  if (marker.authority && marker.proof.verificationMethod !== marker.authority) {
    errors.push(
      `Proof signer ${marker.proof.verificationMethod} does not match claimed authority ${marker.authority}`
    );
  }

  try {
    const did = marker.proof.verificationMethod;
    const alg = algorithmFromDid(did);
    const publicKey = alg === "P-256"
      ? publicKeyFromP256Did(did)
      : publicKeyFromDid(did);
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
      errors.push("Revocation signature verification failed");
    }
  } catch (e) {
    errors.push(`Revocation verification error: ${(e as Error).message}`);
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Check if an arrival has been revoked.
 */
export function isRevoked(arrivalId: string, revocations: RevocationMarker[]): boolean {
  return revocations.some((r) => r.arrivalRef === arrivalId);
}
