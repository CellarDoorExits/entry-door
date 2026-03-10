/**
 * cellar-door-entry — Conflict Resolution Strategies
 *
 * When multiple policy rules evaluate a marker, their decisions may conflict.
 * These strategies determine how to resolve them.
 */

export type ConflictStrategy = "deny-overrides" | "first-match" | "permit-overrides";

export type RuleDecision = "admit" | "deny" | "abstain";

export interface RuleResult {
  name: string;
  decision: RuleDecision;
  reason: string;
  conditions?: string[];
}

export interface ResolvedDecision {
  admitted: boolean;
  reasons: string[];
  conditions: string[];
  ruleResults: RuleResult[];
}

/**
 * Resolve a set of rule results using the given strategy.
 *
 * @param defaultDecision - What to do when no rules produce a decisive result.
 *   Defaults to 'deny' (fail-closed). Use 'admit' only for explicit open-door policies.
 */
export function resolveConflict(
  results: RuleResult[],
  strategy: ConflictStrategy = "deny-overrides",
  defaultDecision: "admit" | "deny" = "deny"
): ResolvedDecision {
  const reasons: string[] = [];
  const conditions: string[] = [];

  // Gather conditions from all non-abstaining results
  for (const r of results) {
    if (r.conditions) conditions.push(...r.conditions);
  }

  const decisive = results.filter((r) => r.decision !== "abstain");

  if (decisive.length === 0) {
    // No decisive rules — use configured default (deny by default: fail-closed)
    const admitted = defaultDecision === "admit";
    return {
      admitted,
      reasons: [admitted ? "No rules produced a decision — default admit" : "No rules produced a decision — default deny"],
      conditions,
      ruleResults: results,
    };
  }

  switch (strategy) {
    case "deny-overrides": {
      const denied = decisive.filter((r) => r.decision === "deny");
      if (denied.length > 0) {
        return {
          admitted: false,
          reasons: denied.map((r) => `[${r.name}] ${r.reason}`),
          conditions,
          ruleResults: results,
        };
      }
      const admitted = decisive.filter((r) => r.decision === "admit");
      return {
        admitted: true,
        reasons: admitted.map((r) => `[${r.name}] ${r.reason}`),
        conditions,
        ruleResults: results,
      };
    }

    case "first-match": {
      const first = decisive[0];
      return {
        admitted: first.decision === "admit",
        reasons: [`[${first.name}] ${first.reason}`],
        conditions: first.conditions ?? [],
        ruleResults: results,
      };
    }

    case "permit-overrides": {
      const admitted = decisive.filter((r) => r.decision === "admit");
      if (admitted.length > 0) {
        return {
          admitted: true,
          reasons: admitted.map((r) => `[${r.name}] ${r.reason}`),
          conditions,
          ruleResults: results,
        };
      }
      const denied = decisive.filter((r) => r.decision === "deny");
      return {
        admitted: false,
        reasons: denied.map((r) => `[${r.name}] ${r.reason}`),
        conditions,
        ruleResults: results,
      };
    }
  }
}
