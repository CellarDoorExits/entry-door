/**
 * Trust level rule — self_only → probation mapping.
 */

import { StatusConfirmation, deriveStatusConfirmation } from "cellar-door-exit";
import type { ExitMarker } from "cellar-door-exit";
import type { RuleResult } from "../conflict.js";
import type { PolicyRule, RuleContext } from "./types.js";
import { formatCondition } from "./condition.js";

export type SelfOnlyAction = "probation" | "reject" | "admit";

export interface TrustLevelRuleConfig {
  action: SelfOnlyAction;
  probationDuration?: string;
}

export function createTrustLevelRule(config: TrustLevelRuleConfig): PolicyRule {
  return {
    name: "trust-level",
    evaluate(marker: ExitMarker | null, ctx: RuleContext): RuleResult {
      if (ctx.isMinting || !marker) {
        return { name: "trust-level", decision: "abstain", reason: "No marker to check trust level" };
      }
      const level = deriveStatusConfirmation(marker);
      if (level !== StatusConfirmation.SelfOnly) {
        return { name: "trust-level", decision: "abstain", reason: `Trust level ${level} is not self_only` };
      }

      switch (config.action) {
        case "reject":
          return { name: "trust-level", decision: "deny", reason: "Self-only markers rejected by policy" };
        case "probation":
          return {
            name: "trust-level",
            decision: "admit",
            reason: "Self-only marker admitted with probation",
            conditions: [
              formatCondition({ type: "probation" }),
              ...(config.probationDuration ? [formatCondition({ type: "probation", params: { duration: config.probationDuration } })] : []),
            ],
          };
        case "admit":
          return { name: "trust-level", decision: "admit", reason: "Self-only marker admitted" };
      }
    },
    toJSON() {
      return { type: "trust-level", ...config };
    },
  };
}
