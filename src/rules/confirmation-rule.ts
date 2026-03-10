/**
 * Confirmation level rule — checks StatusConfirmation minimum.
 */

import { StatusConfirmation, deriveStatusConfirmation } from "cellar-door-exit";
import type { ExitMarker } from "cellar-door-exit";
import type { RuleResult } from "../conflict.js";
import type { PolicyRule, RuleContext } from "./types.js";

const LEVEL_ORDER: StatusConfirmation[] = [
  StatusConfirmation.SelfOnly,
  StatusConfirmation.OriginOnly,
  StatusConfirmation.Mutual,
  StatusConfirmation.Witnessed,
];

function levelIndex(level: StatusConfirmation): number {
  const idx = LEVEL_ORDER.indexOf(level);
  return idx >= 0 ? idx : 0;
}

export interface ConfirmationRuleConfig {
  requiredLevel: StatusConfirmation;
}

export function createConfirmationRule(config: ConfirmationRuleConfig): PolicyRule {
  return {
    name: "confirmation-level",
    evaluate(marker: ExitMarker | null, ctx: RuleContext): RuleResult {
      if (ctx.isMinting || !marker) {
        return { name: "confirmation-level", decision: "abstain", reason: "No marker to check confirmation" };
      }
      const actual = deriveStatusConfirmation(marker);
      const actualIdx = levelIndex(actual);
      const requiredIdx = levelIndex(config.requiredLevel);
      if (actualIdx >= requiredIdx) {
        return { name: "confirmation-level", decision: "admit", reason: `Confirmation level ${actual} meets minimum ${config.requiredLevel}` };
      }
      return { name: "confirmation-level", decision: "deny", reason: `Confirmation level ${actual} below required ${config.requiredLevel}` };
    },
    toJSON() {
      return { type: "confirmation-level", requiredLevel: config.requiredLevel };
    },
  };
}
