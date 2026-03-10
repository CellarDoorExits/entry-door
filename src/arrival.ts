/**
 * cellar-door-entry — Arrival Marker Creation
 */

import { sha256 } from "@noble/hashes/sha256";
import _canonicalize from "canonicalize";
import type { ExitMarker } from "cellar-door-exit";
import { verifyDeparture } from "./verify-departure.js";
import {
  type ArrivalMarker,
  type CreateArrivalOpts,
  ENTRY_CONTEXT_V1,
} from "./types.js";

/**
 * RFC 8785 JSON Canonicalization Scheme (JCS).
 */
export function canonicalize(obj: unknown): string {
  const result = _canonicalize(obj);
  if (result === undefined) return "null";
  return result;
}

/**
 * Compute content-addressed ID for an arrival marker (excluding proof and id).
 */
export function computeArrivalId(marker: Omit<ArrivalMarker, "id" | "proof">): string {
  const canonical = canonicalize(marker);
  const hash = sha256(new TextEncoder().encode(canonical));
  return Array.from(hash)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Create an arrival marker linked to a verified EXIT marker.
 *
 * Verifies the EXIT marker, then produces an unsigned ArrivalMarker.
 */
export function createArrivalMarker(
  exitMarker: ExitMarker,
  destination: string,
  opts?: CreateArrivalOpts
): ArrivalMarker {
  // Deep clone to prevent mutation of caller's exit marker (ADV-006)
  const exit: ExitMarker = JSON.parse(JSON.stringify(exitMarker));
  const verificationResult = verifyDeparture(exit);
  const admissionType = opts?.admissionType ?? (verificationResult.valid ? "automatic" : "reviewed");
  const timestamp = opts?.timestamp ?? new Date().toISOString();

  const body = {
    "@context": ENTRY_CONTEXT_V1 as typeof ENTRY_CONTEXT_V1,
    type: "ArrivalMarker" as const,
    departureRef: exit.id,
    departureOrigin: exit.origin,
    destination,
    subject: exit.subject,
    timestamp,
    admissionType,
    ...(opts?.conditions ? { conditions: opts.conditions } : {}),
    verificationResult,
    ...(opts?.probation ? { probation: opts.probation } : {}),
    ...(opts?.capabilityScope ? { capabilityScope: opts.capabilityScope } : {}),
  };

  const id = `urn:entry:${computeArrivalId(body as Omit<ArrivalMarker, "id" | "proof">)}`;

  return { ...body, id } as ArrivalMarker;
}
