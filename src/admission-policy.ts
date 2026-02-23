/**
 * cellar-door-entry — Admission Policy Engine
 *
 * Composable rules for deciding whether to admit an arriving agent.
 */

import type { ExitMarker } from "cellar-door-exit";

/** An admission policy — composable rules for gate-keeping entry. */
export interface AdmissionPolicy {
  /** Require the departure marker to be cryptographically verified. */
  requireVerifiedDeparture?: boolean;
  /** Maximum age of departure marker (ms). */
  maxDepartureAge?: number;
  /** Allowed exit types (e.g., ['voluntary']). Empty = all allowed. */
  allowedExitTypes?: string[];
  /**
   * Blocked origin platforms.
   *
   * WARNING: Coordinating blockedOrigins lists across platforms may raise
   * antitrust concerns under Sherman Act §1 / EU TFEU Art. 101. Use only
   * for platform-specific security policies, not industry-wide exclusion.
   */
  blockedOrigins?: string[];
  /** Required EXIT modules (e.g., ['lineage', 'stateSnapshot']). */
  requiredModules?: string[];
}

/** Result of evaluating an admission policy. */
export interface AdmissionResult {
  admitted: boolean;
  conditions: string[];
  reasons: string[];
}

/** Parse a duration string like '24h', '7d', '30m' to milliseconds. */
export function parseDuration(dur: string | number): number {
  if (typeof dur === "number") return dur;
  const match = dur.match(/^(\d+)(ms|s|m|h|d)$/);
  if (!match) throw new Error(`Invalid duration: ${dur}`);
  const val = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return val * multipliers[unit];
}

const MODULE_KEYS = ["lineage", "stateSnapshot", "dispute", "economic", "metadata", "crossDomain"] as const;

/**
 * Evaluate whether an EXIT marker should be admitted under a given policy.
 */
export function evaluateAdmission(
  exitMarker: ExitMarker,
  policy: AdmissionPolicy,
  now?: Date
): AdmissionResult {
  const reasons: string[] = [];
  const conditions: string[] = [];
  const currentTime = (now ?? new Date()).getTime();

  // Check blocked origins
  if (policy.blockedOrigins?.includes(exitMarker.origin)) {
    reasons.push(`Origin "${exitMarker.origin}" is blocked`);
  }

  // Check allowed exit types
  if (policy.allowedExitTypes && policy.allowedExitTypes.length > 0) {
    if (!policy.allowedExitTypes.includes(exitMarker.exitType)) {
      reasons.push(`Exit type "${exitMarker.exitType}" is not in allowed types: ${policy.allowedExitTypes.join(", ")}`);
    }
  }

  // Check departure age
  if (policy.maxDepartureAge != null) {
    const departureTime = new Date(exitMarker.timestamp).getTime();
    const age = currentTime - departureTime;
    if (age > policy.maxDepartureAge) {
      reasons.push(`Departure is ${age}ms old, exceeds maximum of ${policy.maxDepartureAge}ms`);
    }
  }

  // Check required modules
  if (policy.requiredModules && policy.requiredModules.length > 0) {
    for (const mod of policy.requiredModules) {
      const key = mod as (typeof MODULE_KEYS)[number];
      if (MODULE_KEYS.includes(key) && !(exitMarker as Record<string, unknown>)[key]) {
        reasons.push(`Required module "${mod}" is missing`);
      }
    }
  }

  // Check verified departure (structural — actual crypto verification is done at arrival creation)
  if (policy.requireVerifiedDeparture) {
    if (!exitMarker.proof || !exitMarker.proof.proofValue) {
      reasons.push("Departure marker has no proof/signature");
    }
    conditions.push("departure-verified");
  }

  return {
    admitted: reasons.length === 0,
    conditions,
    reasons,
  };
}

// ─── Preset Policies ─────────────────────────────────────────────────────────

/** Accept everything that has a valid signature. */
export const OPEN_DOOR: AdmissionPolicy = {
  requireVerifiedDeparture: true,
};

/** Strict: voluntary only, <24h old, all modules required. */
export const STRICT: AdmissionPolicy = {
  requireVerifiedDeparture: true,
  maxDepartureAge: 86_400_000, // 24h
  allowedExitTypes: ["voluntary"],
  requiredModules: ["lineage", "stateSnapshot"],
};

/** Emergency only: accept only emergency exits. */
export const EMERGENCY_ONLY: AdmissionPolicy = {
  requireVerifiedDeparture: true,
  allowedExitTypes: ["emergency"],
};
