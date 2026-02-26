/**
 * cellar-door-entry — Input Validation
 *
 * Validates ArrivalMarker fields, consistent with exit's validation patterns.
 */

import { canonicalize } from "./arrival.js";
import type { ArrivalMarker } from "./types.js";
import { ENTRY_CONTEXT_V1 } from "./types.js";

/** Maximum serialized size of an arrival marker (8KB, consistent with exit). */
export const MAX_MARKER_SIZE = 8192;

/** Validation result. */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** DID format regex (did:key:z6Mk...). */
const DID_REGEX = /^did:[a-z0-9]+:[a-zA-Z0-9._:%-]+$/;

/** ISO 8601 UTC timestamp regex. */
const ISO_TIMESTAMP_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/**
 * Validate an ArrivalMarker's fields.
 */
export function validateArrivalMarker(marker: unknown): ValidationResult {
  const errors: string[] = [];

  if (!marker || typeof marker !== "object") {
    return { valid: false, errors: ["Marker must be a non-null object"] };
  }

  const m = marker as Record<string, unknown>;

  // Size check (byte length)
  try {
    const serialized = JSON.stringify(m);
    const byteLength = new TextEncoder().encode(serialized).byteLength;
    if (byteLength > MAX_MARKER_SIZE) {
      errors.push(`Marker exceeds maximum size of ${MAX_MARKER_SIZE} bytes (got ${byteLength})`);
    }
  } catch {
    errors.push("Marker cannot be serialized to JSON");
  }

  // ADV-002: Reject strings containing control characters (except \n, \r, \t)
  for (const field of ["subject", "departureRef", "departureOrigin", "destination", "id"] as const) {
    if (typeof m[field] === "string" && /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(m[field] as string)) {
      errors.push(`${field} contains invalid control characters`);
    }
  }

  // Context
  if (m["@context"] !== ENTRY_CONTEXT_V1) {
    errors.push(`Invalid @context: expected "${ENTRY_CONTEXT_V1}", got "${m["@context"]}"`);
  }

  // ID
  if (typeof m.id !== "string" || !m.id.startsWith("urn:entry:")) {
    errors.push(`Invalid id: must be a string starting with "urn:entry:", got "${m.id}"`);
  }

  // departureRef
  if (typeof m.departureRef !== "string" || !m.departureRef) {
    errors.push("Missing or invalid departureRef");
  }

  // departureOrigin
  if (typeof m.departureOrigin !== "string" || !m.departureOrigin) {
    errors.push("Missing or invalid departureOrigin");
  }

  // destination
  if (typeof m.destination !== "string" || !m.destination) {
    errors.push("Missing or invalid destination");
  }

  // subject (DID format)
  if (typeof m.subject !== "string") {
    errors.push("Missing subject");
  } else if (!DID_REGEX.test(m.subject)) {
    errors.push(`Invalid subject DID format: "${m.subject}"`);
  }

  // timestamp (ISO 8601 UTC)
  if (typeof m.timestamp !== "string") {
    errors.push("Missing timestamp");
  } else if (!ISO_TIMESTAMP_REGEX.test(m.timestamp)) {
    errors.push(`Invalid timestamp format (must be ISO 8601 UTC): "${m.timestamp}"`);
  } else {
    const ts = new Date(m.timestamp).getTime();
    if (isNaN(ts)) {
      errors.push(`Timestamp parses to invalid date: "${m.timestamp}"`);
    }
  }

  // admissionType
  const validAdmissionTypes = ["automatic", "reviewed", "conditional"];
  if (!validAdmissionTypes.includes(m.admissionType as string)) {
    errors.push(`Invalid admissionType: "${m.admissionType}"`);
  }

  // verificationResult
  if (!m.verificationResult || typeof m.verificationResult !== "object") {
    errors.push("Missing verificationResult");
  } else {
    const vr = m.verificationResult as Record<string, unknown>;
    if (typeof vr.valid !== "boolean") {
      errors.push("verificationResult.valid must be a boolean");
    }
    if (!Array.isArray(vr.errors)) {
      errors.push("verificationResult.errors must be an array");
    }
  }

  // conditions (if present, must be array of strings)
  if (m.conditions !== undefined) {
    if (!Array.isArray(m.conditions) || !m.conditions.every((c: unknown) => typeof c === "string")) {
      errors.push("conditions must be an array of strings");
    }
  }

  return { valid: errors.length === 0, errors };
}
