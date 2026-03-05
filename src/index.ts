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
export { verifyDeparture, verifyDepartureJSON } from "./verify-departure.js";

// Create arrival markers
export { createArrivalMarker, canonicalize, computeArrivalId } from "./arrival.js";

// Sign and verify arrival markers
export { signArrivalMarker, verifyArrivalMarker, type ArrivalVerificationResult, type SignatureAlgorithm } from "./sign.js";

// Continuity verification
export { verifyContinuity } from "./continuity.js";

// Convenience
export { quickEntry, quickEntryP256, type QuickEntryResult, type QuickEntryOpts } from "./convenience.js";

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

// Validation
export {
  validateArrivalMarker,
  MAX_MARKER_SIZE,
  type ValidationResult,
} from "./validation.js";
