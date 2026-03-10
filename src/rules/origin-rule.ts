/**
 * Origin rule — allowlist/blocklist with required reasons for blocks.
 */

import type { ExitMarker } from "cellar-door-exit";
import type { RuleResult } from "../conflict.js";
import type { PolicyRule, RuleContext } from "./types.js";

export type BlockReasonCategory = "security" | "compliance" | "operational" | "other";

export interface BlockReason {
  category: BlockReasonCategory;
  detail: string;
}

export interface BlockedOriginEntry {
  origin: string;
  reason: string | BlockReason;
  /** Optional expiration. Block is ignored after this time. */
  expiresAt?: string;
}

export interface OriginRuleConfig {
  blockedOrigins?: BlockedOriginEntry[];
  allowedOrigins?: string[];
}

export function createOriginRule(config: OriginRuleConfig): PolicyRule {
  return {
    name: "origin-check",
    evaluate(marker: ExitMarker | null, ctx: RuleContext): RuleResult {
      if (ctx.isMinting || !marker) {
        return { name: "origin-check", decision: "abstain", reason: "No marker to check origin" };
      }
      const origin = marker.origin;

      // Check blocklist first (skip expired entries)
      if (config.blockedOrigins) {
        const now = ctx.now.getTime();
        const blocked = config.blockedOrigins.find((b) => {
          if (b.origin !== origin) return false;
          if (b.expiresAt && new Date(b.expiresAt).getTime() <= now) return false;
          return true;
        });
        if (blocked) {
          const reasonStr = typeof blocked.reason === "string"
            ? blocked.reason
            : `[${blocked.reason.category}] ${blocked.reason.detail}`;
          return { name: "origin-check", decision: "deny", reason: `Origin "${origin}" is blocked: ${reasonStr}` };
        }
      }

      // Check allowlist (if specified, only allowed origins pass)
      if (config.allowedOrigins && config.allowedOrigins.length > 0) {
        if (!config.allowedOrigins.includes(origin)) {
          return { name: "origin-check", decision: "deny", reason: `Origin "${origin}" not in allowed list` };
        }
      }

      return { name: "origin-check", decision: "admit", reason: `Origin "${origin}" is acceptable` };
    },
    toJSON() {
      return { type: "origin-check", ...config };
    },
  };
}
