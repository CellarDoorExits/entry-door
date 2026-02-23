/**
 * cellar-door-entry — Revocation
 *
 * Revoke arrivals after the fact (e.g., fraud discovered, policy violation).
 */

import { sign, verify, didFromPublicKey, publicKeyFromDid } from "cellar-door-exit";
import { canonicalize } from "./arrival.js";
import type { ArrivalMarker } from "./types.js";

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
    type: "Ed25519Signature2020";
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
  publicKey: Uint8Array
): RevocationMarker {
  const did = didFromPublicKey(publicKey);

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
  const data = new TextEncoder().encode(canonical);
  const signature = sign(data, privateKey);
  const proofValue = btoa(String.fromCharCode(...signature));

  return {
    ...body,
    proof: {
      type: "Ed25519Signature2020",
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
    const publicKey = publicKeyFromDid(marker.proof.verificationMethod);
    const { proof: _proof, ...rest } = marker;
    const canonical = canonicalize(rest);
    const data = new TextEncoder().encode(canonical);
    const sigStr = atob(marker.proof.proofValue);
    const signature = new Uint8Array(sigStr.length);
    for (let i = 0; i < sigStr.length; i++) signature[i] = sigStr.charCodeAt(i);
    if (!verify(data, signature, publicKey)) {
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
