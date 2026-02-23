/**
 * cellar-door-entry — Capability Scoping
 *
 * Determines what an arriving agent is allowed to do.
 */

import type { ExitMarker } from "cellar-door-exit";
import type { CapabilityScope } from "./types.js";

/**
 * Extract capability hints from an EXIT marker's modules.
 *
 * - Module A (lineage) → "identity-continuity"
 * - Module B (stateSnapshot) → "state-portability"
 * - Module C (dispute) → "dispute-context"
 * - Module D (economic) → "economic-portability"
 * - Module E (metadata) → "metadata-access"
 * - Module F (crossDomain) → "cross-domain-reference"
 */
export function scopeFromExitMarker(marker: ExitMarker): CapabilityScope {
  const allowed: string[] = [];

  if (marker.lineage) allowed.push("identity-continuity");
  if (marker.stateSnapshot) allowed.push("state-portability");
  if (marker.dispute) allowed.push("dispute-context");
  if (marker.economic) allowed.push("economic-portability");
  if (marker.metadata) allowed.push("metadata-access");
  if (marker.crossDomain) allowed.push("cross-domain-reference");

  // Base capabilities everyone gets
  allowed.push("basic-interaction");

  return { allowed, denied: [] };
}

/**
 * Create a restricted capability scope.
 */
export function createRestrictedScope(
  allowed: string[],
  denied: string[],
  expires?: string
): CapabilityScope {
  return { allowed, denied, ...(expires ? { expires } : {}) };
}

/**
 * Merge two capability scopes. Denied always wins over allowed.
 */
export function mergeScopes(a: CapabilityScope, b: CapabilityScope): CapabilityScope {
  const allAllowed = [...new Set([...a.allowed, ...b.allowed])];
  const allDenied = [...new Set([...a.denied, ...b.denied])];
  // Denied wins: remove denied items from allowed
  const allowed = allAllowed.filter((cap) => !allDenied.includes(cap));
  // Use earliest expiry
  let expires: string | undefined;
  if (a.expires && b.expires) {
    expires = a.expires < b.expires ? a.expires : b.expires;
  } else {
    expires = a.expires ?? b.expires;
  }
  return { allowed, denied: allDenied, ...(expires ? { expires } : {}) };
}
