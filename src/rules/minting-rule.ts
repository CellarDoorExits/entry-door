/**
 * Minting rule — controls whether minting (admission without departure) is allowed.
 */

import type { ExitMarker } from "cellar-door-exit";
import type { RuleResult } from "../conflict.js";
import type { PolicyRule, RuleContext } from "./types.js";

export interface MintingRuleConfig {
  allowed: boolean;
  requireJustification?: boolean;
  enhancedProbation?: string;
}

export function createMintingRule(config: MintingRuleConfig): PolicyRule {
  return {
    name: "minting",
    evaluate(_marker: ExitMarker | null, ctx: RuleContext): RuleResult {
      if (!ctx.isMinting) {
        return { name: "minting", decision: "abstain", reason: "Not a minting operation" };
      }
      if (!config.allowed) {
        return { name: "minting", decision: "deny", reason: "Minting is not allowed by policy" };
      }
      if (config.requireJustification && !ctx.mintingJustification) {
        return { name: "minting", decision: "deny", reason: "Minting requires a justification" };
      }
      const conditions: string[] = [];
      if (config.enhancedProbation) {
        conditions.push("probation", `probation-duration:${config.enhancedProbation}`);
      }
      return {
        name: "minting",
        decision: "admit",
        reason: "Minting allowed by policy",
        conditions,
      };
    },
    toJSON() {
      return { type: "minting", ...config };
    },
  };
}
