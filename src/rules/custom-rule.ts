/**
 * Custom rule — user-defined evaluation functions.
 * NOT serializable (functions cannot be serialized).
 */

import type { ExitMarker } from "cellar-door-exit";
import type { RuleResult } from "../conflict.js";
import type { PolicyRule, RuleContext } from "./types.js";

export type CustomRuleFn = (marker: ExitMarker | null, ctx: RuleContext) => { admitted: boolean; conditions?: string[]; reason?: string };

export function createCustomRule(name: string, fn: CustomRuleFn): PolicyRule {
  return {
    name,
    evaluate(marker: ExitMarker | null, ctx: RuleContext): RuleResult {
      const result = fn(marker, ctx);
      return {
        name,
        decision: result.admitted ? "admit" : "deny",
        reason: result.reason ?? (result.admitted ? "Custom rule passed" : "Custom rule failed"),
        conditions: result.conditions,
      };
    },
    // No toJSON — custom rules are not serializable
  };
}
