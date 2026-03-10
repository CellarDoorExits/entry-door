/**
 * cellar-door-entry — Policy Builder v2
 *
 * Fluent builder for composable, serializable admission policies.
 */

import { StatusConfirmation } from "cellar-door-exit";
import type { ExitMarker } from "cellar-door-exit";
import { type ConflictStrategy, type RuleResult, resolveConflict, type ResolvedDecision } from "./conflict.js";
import { parseDuration } from "./admission-policy.js";
import type { PolicyRule, RuleContext } from "./rules/types.js";
import { createConfirmationRule } from "./rules/confirmation-rule.js";
import { createOriginRule } from "./rules/origin-rule.js";
import { createDisputeRule, type DisputeAction } from "./rules/dispute-rule.js";
import { createTrustLevelRule, type SelfOnlyAction } from "./rules/trust-level-rule.js";
import { createMintingRule } from "./rules/minting-rule.js";
import { createCustomRule, type CustomRuleFn } from "./rules/custom-rule.js";

export interface EvaluationTrace {
  policyName: string;
  rules: RuleResult[];
  decision: ResolvedDecision;
  timestamp: string;
}

export interface BuiltPolicy {
  name: string;
  rules: PolicyRule[];
  conflictStrategy: ConflictStrategy;
  defaultDecision: "admit" | "deny";
  /** Warnings from deserialization (e.g. unknown rule types). */
  _warnings?: string[];
  /** Evaluate a marker (or null for minting). */
  evaluate(marker: ExitMarker | null, ctx?: Partial<RuleContext>): ResolvedDecision;
  /** Dry-run evaluation returning a full trace. */
  dryRun(marker: ExitMarker | null, ctx?: Partial<RuleContext>): EvaluationTrace;
  /** Serialize to JSON (custom rules are excluded with a warning). */
  toJSON(): PolicyJSON;
}

export interface PolicyJSON {
  name: string;
  conflictStrategy: ConflictStrategy;
  rules: Array<Record<string, unknown>>;
  /** Custom rule names that were NOT serialized. */
  customRulesOmitted: string[];
}

function buildContext(partial?: Partial<RuleContext>): RuleContext {
  return {
    isMinting: partial?.isMinting ?? false,
    now: partial?.now ?? new Date(),
    mintingJustification: partial?.mintingJustification,
  };
}

/**
 * Fluent policy builder.
 */
export class PolicyBuilder {
  private _name: string;
  private _rules: PolicyRule[] = [];
  private _strategy: ConflictStrategy = "deny-overrides";
  private _defaultDecision: "admit" | "deny" = "deny";
  // Track serializable config for reconstruction
  private _ruleConfigs: Array<{ type: string; config: Record<string, unknown> } | null> = [];
  private _warnings: string[] = [];

  constructor(name: string) {
    this._name = name;
  }

  requireConfirmation(level: StatusConfirmation | "self_only" | "origin_only" | "mutual" | "witnessed"): this {
    const resolved = typeof level === "string" ? this._resolveConfirmation(level) : level;
    this._rules.push(createConfirmationRule({ requiredLevel: resolved }));
    this._ruleConfigs.push({ type: "confirmation-level", config: { requiredLevel: resolved } });
    return this;
  }

  private _resolveConfirmation(level: string): StatusConfirmation {
    const map: Record<string, StatusConfirmation> = {
      self_only: StatusConfirmation.SelfOnly,
      origin_only: StatusConfirmation.OriginOnly,
      mutual: StatusConfirmation.Mutual,
      witnessed: StatusConfirmation.Witnessed,
    };
    return map[level] ?? StatusConfirmation.SelfOnly;
  }

  requireVerifiedDeparture(): this {
    this._rules.push({
      name: "verified-departure",
      evaluate(marker, ctx) {
        if (ctx.isMinting || !marker) {
          return { name: "verified-departure", decision: "abstain", reason: "No marker to verify" };
        }
        if (!marker.proof?.proofValue) {
          return { name: "verified-departure", decision: "deny", reason: "Departure marker has no proof" };
        }
        return { name: "verified-departure", decision: "admit", reason: "Departure is signed" };
      },
      toJSON() {
        return { type: "verified-departure" };
      },
    });
    this._ruleConfigs.push({ type: "verified-departure", config: {} });
    return this;
  }

  maxAge(duration: string | number): this {
    const maxMs = typeof duration === "string" ? parseDuration(duration) : duration;
    const durStr = typeof duration === "string" ? duration : `${duration}ms`;
    this._rules.push({
      name: "max-age",
      evaluate(marker, ctx) {
        if (ctx.isMinting || !marker) {
          return { name: "max-age", decision: "abstain", reason: "No marker to check age" };
        }
        const age = ctx.now.getTime() - new Date(marker.timestamp).getTime();
        if (age > maxMs) {
          return { name: "max-age", decision: "deny", reason: `Marker is ${age}ms old, exceeds ${durStr}` };
        }
        return { name: "max-age", decision: "admit", reason: `Marker age ${age}ms within ${durStr}` };
      },
      toJSON() {
        return { type: "max-age", duration: durStr };
      },
    });
    this._ruleConfigs.push({ type: "max-age", config: { duration: durStr } });
    return this;
  }

  allowExitTypes(types: string[]): this {
    this._rules.push({
      name: "exit-type",
      evaluate(marker, ctx) {
        if (ctx.isMinting || !marker) {
          return { name: "exit-type", decision: "abstain", reason: "No marker to check exit type" };
        }
        if (types.includes(marker.exitType)) {
          return { name: "exit-type", decision: "admit", reason: `Exit type "${marker.exitType}" is allowed` };
        }
        return { name: "exit-type", decision: "deny", reason: `Exit type "${marker.exitType}" not in ${types.join(", ")}` };
      },
      toJSON() {
        return { type: "exit-type", allowedTypes: types };
      },
    });
    this._ruleConfigs.push({ type: "exit-type", config: { allowedTypes: types } });
    return this;
  }

  blockOrigins(origins: string[], opts: { reason: string }): this {
    this._rules.push(createOriginRule({
      blockedOrigins: origins.map((o) => ({ origin: o, reason: opts.reason })),
    }));
    this._ruleConfigs.push({ type: "origin-check", config: { blockedOrigins: origins.map((o) => ({ origin: o, reason: opts.reason })) } });
    return this;
  }

  allowOrigins(origins: string[]): this {
    this._rules.push(createOriginRule({ allowedOrigins: origins }));
    this._ruleConfigs.push({ type: "origin-check", config: { allowedOrigins: origins } });
    return this;
  }

  requireModules(modules: string[]): this {
    this._rules.push({
      name: "required-modules",
      evaluate(marker, ctx) {
        if (ctx.isMinting || !marker) {
          return { name: "required-modules", decision: "abstain", reason: "No marker to check modules" };
        }
        const missing: string[] = [];
        for (const mod of modules) {
          if (!(marker as any)[mod]) missing.push(mod);
        }
        if (missing.length > 0) {
          return { name: "required-modules", decision: "deny", reason: `Missing modules: ${missing.join(", ")}` };
        }
        return { name: "required-modules", decision: "admit", reason: "All required modules present" };
      },
      toJSON() {
        return { type: "required-modules", modules };
      },
    });
    this._ruleConfigs.push({ type: "required-modules", config: { modules } });
    return this;
  }

  onDisputed(action: DisputeAction, opts?: { maxDuration?: string; reviewRequired?: boolean }): this {
    this._rules.push(createDisputeRule({ action, maxDuration: opts?.maxDuration, reviewRequired: opts?.reviewRequired }));
    this._ruleConfigs.push({ type: "dispute-check", config: { action, ...opts } });
    return this;
  }

  onSelfOnly(action: SelfOnlyAction, opts?: { duration?: string }): this {
    this._rules.push(createTrustLevelRule({ action, probationDuration: opts?.duration }));
    this._ruleConfigs.push({ type: "trust-level", config: { action, probationDuration: opts?.duration } });
    return this;
  }

  allowMinting(opts?: { requireJustification?: boolean; enhancedProbation?: string }): this {
    this._rules.push(createMintingRule({
      allowed: true,
      requireJustification: opts?.requireJustification,
      enhancedProbation: opts?.enhancedProbation,
    }));
    this._ruleConfigs.push({ type: "minting", config: { allowed: true, ...opts } });
    return this;
  }

  custom(name: string, fn: CustomRuleFn): this {
    this._rules.push(createCustomRule(name, fn));
    this._ruleConfigs.push(null); // Not serializable
    return this;
  }

  conflictResolution(strategy: ConflictStrategy): this {
    this._strategy = strategy;
    return this;
  }

  /**
   * Set the default decision when no rules produce a decisive result.
   * Defaults to 'deny' (fail-closed). Use 'admit' for explicit open-door policies.
   */
  defaultDecision(decision: "admit" | "deny"): this {
    this._defaultDecision = decision;
    return this;
  }

  build(): BuiltPolicy {
    const rules = [...this._rules];
    const strategy = this._strategy;
    const name = this._name;
    const defaultDec = this._defaultDecision;
    const ruleConfigs = [...this._ruleConfigs];
    const warnings = [...this._warnings];

    function evaluate(marker: ExitMarker | null, ctxPartial?: Partial<RuleContext>): ResolvedDecision {
      const ctx = buildContext(ctxPartial);
      const results: RuleResult[] = rules.map((r) => r.evaluate(marker, ctx));
      return resolveConflict(results, strategy, defaultDec);
    }

    function dryRun(marker: ExitMarker | null, ctxPartial?: Partial<RuleContext>): EvaluationTrace {
      const ctx = buildContext(ctxPartial);
      const results: RuleResult[] = rules.map((r) => r.evaluate(marker, ctx));
      const decision = resolveConflict(results, strategy, defaultDec);
      return { policyName: name, rules: results, decision, timestamp: new Date().toISOString() };
    }

    function toJSON(): PolicyJSON {
      const serializable: Array<Record<string, unknown>> = [];
      const customOmitted: string[] = [];
      for (let i = 0; i < rules.length; i++) {
        const cfg = ruleConfigs[i];
        if (cfg) {
          serializable.push(cfg.config ? { ...cfg.config, type: cfg.type } : { type: cfg.type });
        } else {
          customOmitted.push(rules[i].name);
        }
      }
      return { name, conflictStrategy: strategy, rules: serializable, customRulesOmitted: customOmitted };
    }

    return { name, rules, conflictStrategy: strategy, defaultDecision: defaultDec, _warnings: warnings.length > 0 ? warnings : undefined, evaluate, dryRun, toJSON };
  }

  /**
   * Reconstruct a PolicyBuilder from JSON.
   * Custom rules are NOT restored (they are not serializable).
   */
  static fromJSON(json: PolicyJSON): PolicyBuilder {
    const builder = new PolicyBuilder(json.name);
    builder._strategy = json.conflictStrategy;

    for (const rule of json.rules) {
      switch (rule.type) {
        case "confirmation-level":
          builder.requireConfirmation(rule.requiredLevel as StatusConfirmation);
          break;
        case "verified-departure":
          builder.requireVerifiedDeparture();
          break;
        case "max-age":
          builder.maxAge(rule.duration as string);
          break;
        case "exit-type":
          builder.allowExitTypes(rule.allowedTypes as string[]);
          break;
        case "origin-check":
          if (rule.blockedOrigins) {
            const blocked = rule.blockedOrigins as Array<{ origin: string; reason: string }>;
            builder.blockOrigins(blocked.map((b) => b.origin), { reason: blocked[0]?.reason ?? "Blocked" });
          }
          if (rule.allowedOrigins) {
            builder.allowOrigins(rule.allowedOrigins as string[]);
          }
          break;
        case "required-modules":
          builder.requireModules(rule.modules as string[]);
          break;
        case "dispute-check":
          builder.onDisputed(rule.action as any, { maxDuration: rule.maxDuration as string, reviewRequired: rule.reviewRequired as boolean });
          break;
        case "trust-level":
          builder.onSelfOnly(rule.action as any, { duration: rule.probationDuration as string });
          break;
        case "minting":
          builder.allowMinting({ requireJustification: rule.requireJustification as boolean, enhancedProbation: rule.enhancedProbation as string });
          break;
        default:
          builder._warnings.push(`Unknown rule type: ${rule.type}`);
          break;
      }
    }

    return builder;
  }
}

/**
 * Create a new policy builder.
 */
export function createPolicy(name: string): PolicyBuilder {
  return new PolicyBuilder(name);
}

// ─── Preset Policies ─────────────────────────────────────────────────────────

/** Only admit counter-signed departures. */
export const REQUIRE_MUTUAL: BuiltPolicy = createPolicy("require-mutual")
  .requireConfirmation("mutual")
  .requireVerifiedDeparture()
  .build();

/** Same as REQUIRE_MUTUAL but with minting on-ramp (antitrust-safe). */
export const REQUIRE_MUTUAL_WITH_ONRAMP: BuiltPolicy = createPolicy("require-mutual-with-onramp")
  .requireConfirmation("mutual")
  .requireVerifiedDeparture()
  .allowMinting({ requireJustification: true, enhancedProbation: "14d" })
  .build();

/** Cautious defaults: self_only → probation, disputed → quarantine, minting with justification. */
export const CAUTIOUS: BuiltPolicy = createPolicy("cautious")
  .requireVerifiedDeparture()
  .onSelfOnly("probation", { duration: "7d" })
  .onDisputed("quarantine", { maxDuration: "7d", reviewRequired: true })
  .allowMinting({ requireJustification: true, enhancedProbation: "14d" })
  .build();

/** Open door: admit by default when no rules produce a decision. Explicit fail-open. */
export const OPEN_DOOR_V2: BuiltPolicy = createPolicy("open-door")
  .defaultDecision("admit")
  .build();

/** Unknown origins get quarantined. */
export const QUARANTINE_UNKNOWN: BuiltPolicy = createPolicy("quarantine-unknown")
  .requireVerifiedDeparture()
  .onDisputed("quarantine", { maxDuration: "7d", reviewRequired: true })
  .build();

/** Accept most markers, probation for unverified. */
export const PERMISSIVE: BuiltPolicy = createPolicy("permissive")
  .defaultDecision("admit")
  .onSelfOnly("probation", { duration: "7d" })
  .allowMinting()
  .build();

/** Reject everything. No admissions, no minting. */
export const LOCKDOWN: BuiltPolicy = createPolicy("lockdown")
  .build();
