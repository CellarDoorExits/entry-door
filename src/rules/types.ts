/**
 * Shared types for policy rules.
 */

import type { ExitMarker } from "cellar-door-exit";
import type { RuleResult } from "../conflict.js";

export interface RuleContext {
  /** Whether this is a minting operation (no exit marker). */
  isMinting: boolean;
  /** Current timestamp. */
  now: Date;
  /** Minting justification (if minting). */
  mintingJustification?: string;
  /** Whether the exit marker's cryptographic signature was verified. */
  verified?: boolean;
}

export interface PolicyRule {
  name: string;
  evaluate(marker: ExitMarker | null, ctx: RuleContext): RuleResult;
  /** Serializable config (undefined for custom rules). */
  toJSON?(): Record<string, unknown>;
}
