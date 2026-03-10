/**
 * Dispute rule — handles disputed markers.
 */

import type { ExitMarker } from "cellar-door-exit";
import type { RuleResult } from "../conflict.js";
import type { PolicyRule, RuleContext } from "./types.js";
import { formatCondition } from "./condition.js";

export type DisputeAction = "reject" | "quarantine" | "manual_review";

export interface DisputeRuleConfig {
  action: DisputeAction;
  maxDuration?: string;
  reviewRequired?: boolean;
}

function isDisputed(marker: ExitMarker): boolean {
  return !!(marker.dispute?.disputes && marker.dispute.disputes.length > 0);
}

export function createDisputeRule(config: DisputeRuleConfig): PolicyRule {
  return {
    name: "dispute-check",
    evaluate(marker: ExitMarker | null, ctx: RuleContext): RuleResult {
      if (ctx.isMinting || !marker) {
        return { name: "dispute-check", decision: "abstain", reason: "No marker to check disputes" };
      }
      if (!isDisputed(marker)) {
        return { name: "dispute-check", decision: "abstain", reason: "Marker is not disputed" };
      }

      switch (config.action) {
        case "reject":
          return { name: "dispute-check", decision: "deny", reason: "Disputed marker rejected by policy" };
        case "quarantine":
          return {
            name: "dispute-check",
            decision: "admit",
            reason: "Disputed marker quarantined for review",
            conditions: [
              formatCondition({ type: "quarantine" }),
              ...(config.maxDuration ? [formatCondition({ type: "quarantine", params: { max: config.maxDuration } })] : []),
              ...(config.reviewRequired ? [formatCondition({ type: "review" })] : []),
            ],
          };
        case "manual_review":
          return {
            name: "dispute-check",
            decision: "admit",
            reason: "Disputed marker admitted pending manual review",
            conditions: ["manual-review-required"],
          };
      }
    },
    toJSON() {
      return { type: "dispute-check", ...config };
    },
  };
}
