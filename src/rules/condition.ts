/**
 * Typed conditions for policy rule results.
 */

export type ConditionType =
  | "quarantine"
  | "probation"
  | "review"
  | "enhanced-monitoring"
  | "risk-accepted";

export interface Condition {
  type: ConditionType;
  params?: Record<string, string>;
}

/**
 * Format a Condition into a string like "quarantine" or "probation-duration:7d".
 */
export function formatCondition(c: Condition): string {
  if (!c.params || Object.keys(c.params).length === 0) return c.type;
  return Object.entries(c.params)
    .map(([k, v]) => `${c.type}-${k}:${v}`)
    .join(",");
}

/**
 * Parse a condition string back into a Condition.
 * Handles: "quarantine", "probation-duration:7d", "quarantine-max:7d"
 */
export function parseCondition(s: string): Condition {
  // Check for param pattern: "type-key:value"
  const match = s.match(/^([a-z-]+?)-([a-z]+):(.+)$/);
  if (match) {
    return { type: match[1] as ConditionType, params: { [match[2]]: match[3] } };
  }
  // Simple condition
  return { type: s as ConditionType };
}
