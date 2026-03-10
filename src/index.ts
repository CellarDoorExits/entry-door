/**
 * cellar-door-entry — Verifiable Arrival Markers
 *
 * The ENTRY primitive: verify a departure, create a linked arrival record,
 * and prove identity continuity across domains.
 */

// Types
export {
  ENTRY_CONTEXT_V1,
  type ArrivalMarker,
  type ArrivalProof,
  type ArrivalProofType,
  type VerificationResult,
  type AdmissionType,
  type CreateArrivalOpts,
  type ContinuityResult,
  type ProbationInfo,
  type CapabilityScope,
} from "./types.js";

// Verify departures
export { verifyDeparture, verifyDepartureJSON, type VerifyDepartureJSONResult } from "./verify-departure.js";

// Create arrival markers
export { createArrivalMarker, canonicalize, computeArrivalId } from "./arrival.js";

// Sign and verify arrival markers
export { signArrivalMarker, verifyArrivalMarker, type ArrivalVerificationResult, type SignatureAlgorithm } from "./sign.js";

// Continuity verification
export { verifyContinuity } from "./continuity.js";

// Convenience
export { quickEntry, quickEntryP256, quickAdmit, type QuickEntryResult, type QuickEntryOpts, type QuickAdmitOpts } from "./convenience.js";

// Admission Policy
export {
  evaluateAdmission,
  parseDuration,
  OPEN_DOOR,
  STRICT,
  EMERGENCY_ONLY,
  type AdmissionPolicy,
  type AdmissionResult,
} from "./admission-policy.js";

// Probation
export {
  createProbationaryArrival,
  isProbationComplete,
  type ProbationConfig,
} from "./probation.js";

// Capability Scope
export {
  scopeFromExitMarker,
  createRestrictedScope,
  mergeScopes,
} from "./capability-scope.js";

// Claim Tracking
export {
  InMemoryClaimStore,
  type ClaimStore,
} from "./claim-tracking.js";

// Revocation
export {
  createRevocationMarker,
  verifyRevocationMarker,
  isRevoked,
  type RevocationMarker,
  type RevocationAlgorithm,
} from "./revocation.js";

// Passage (exported as Transfer names for backward compat; renamed in v0.2.0)
export {
  verifyTransfer,
  type TransferRecord,
} from "./transfer.js";

// Admit Ceremony
export {
  admit,
  type AdmitOpts,
  type AdmitResult,
  type AdmitResultAdmitted,
  type AdmitResultRejected,
  type AdmissionRecord,
  type AdmissionStore,
  isAdmissionStore,
  type CounterSignMeaning,
} from "./admit.js";

// Minting
export {
  mintAgent,
  bulkMint,
  type MintOpts,
  type MintResult,
  type BulkMintAgent,
  type BulkMintResult,
} from "./mint.js";

// Policy Builder v2
export {
  createPolicy,
  PolicyBuilder,
  REQUIRE_MUTUAL,
  REQUIRE_MUTUAL_WITH_ONRAMP,
  CAUTIOUS,
  OPEN_DOOR_V2,
  QUARANTINE_UNKNOWN,
  PERMISSIVE,
  LOCKDOWN,
  type BuiltPolicy,
  type EvaluationTrace,
  type PolicyJSON,
} from "./policy-builder.js";

// Conflict Resolution
export {
  resolveConflict,
  type ConflictStrategy,
  type RuleDecision,
  type RuleResult,
  type ResolvedDecision,
} from "./conflict.js";

// Policy Rules
export {
  createConfirmationRule,
  createOriginRule,
  createDisputeRule,
  createTrustLevelRule,
  createMintingRule,
  createCustomRule,
  type PolicyRule,
  type RuleContext,
  type ConfirmationRuleConfig,
  type OriginRuleConfig,
  type DisputeRuleConfig,
  type DisputeAction,
  type TrustLevelRuleConfig,
  type SelfOnlyAction,
  type MintingRuleConfig,
  type CustomRuleFn,
  type BlockedOriginEntry,
  type BlockReason,
  type BlockReasonCategory,
  formatCondition,
  parseCondition,
  type Condition,
  type ConditionType,
} from "./rules/index.js";

// Events
export {
  AdmissionEventEmitter,
  type AdmissionEventType,
  type AdmissionEvent,
  type EmitterOpts,
} from "./events.js";

// SQLite Claim Store
export { SqliteClaimStore, type SqliteClaimStoreOpts } from "./sqlite-store.js";

// Validation
export {
  validateArrivalMarker,
  MAX_MARKER_SIZE,
  type ValidationResult,
} from "./validation.js";
