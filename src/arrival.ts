/**
 * cellar-door-entry — Arrival Marker Creation
 */

import { sha256 } from "@noble/hashes/sha256";
import type { ExitMarker } from "cellar-door-exit";
import { verifyDeparture } from "./verify-departure.js";
import {
  type ArrivalMarker,
  type CreateArrivalOpts,
  ENTRY_CONTEXT_V1,
} from "./types.js";

/**
 * Deterministic JSON canonicalization (sorted keys, recursive).
 */
export function canonicalize(obj: unknown): string {
  if (obj === null || obj === undefined) return JSON.stringify(obj);
  if (typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return "[" + obj.map((v) => canonicalize(v)).join(",") + "]";
  }
  const sorted = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = sorted.map(
    (k) => `${JSON.stringify(k)}:${canonicalize((obj as Record<string, unknown>)[k])}`
  );
  return "{" + pairs.join(",") + "}";
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
  const verificationResult = verifyDeparture(exitMarker);
  const admissionType = opts?.admissionType ?? (verificationResult.valid ? "automatic" : "reviewed");
  const timestamp = opts?.timestamp ?? new Date().toISOString();

  const body = {
    "@context": ENTRY_CONTEXT_V1 as typeof ENTRY_CONTEXT_V1,
    type: "ArrivalMarker" as const,
    departureRef: exitMarker.id,
    departureOrigin: exitMarker.origin,
    destination,
    subject: exitMarker.subject,
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
