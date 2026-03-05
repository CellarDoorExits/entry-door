/**
 * cellar-door-entry — Core Arrival Marker Types
 */

export const ENTRY_CONTEXT_V1 = "https://cellar-door.dev/entry/v1" as const;

/** Result of verifying an EXIT marker during arrival processing. */
export interface VerificationResult {
  valid: boolean;
  errors: string[];
}

/** How the agent was admitted to the destination. */
export type AdmissionType = "automatic" | "reviewed" | "conditional";

/** Supported proof types for arrival markers. */
export type ArrivalProofType = "Ed25519Signature2020" | "EcdsaP256Signature2019";

/** Cryptographic proof on the arrival marker. */
export interface ArrivalProof {
  type: ArrivalProofType;
  created: string;
  verificationMethod: string;
  proofValue: string;
}

/**
 * The Arrival Marker — records a verified arrival linked to a departure.
 */
export interface ArrivalMarker {
  /** JSON-LD context. */
  "@context": typeof ENTRY_CONTEXT_V1;

  /** Globally unique identifier. */
  id: string;

  /** ID of the EXIT marker being continued. */
  departureRef: string;

  /** Origin platform (from the EXIT marker). */
  departureOrigin: string;

  /** Where the agent is arriving (this platform). */
  destination: string;

  /** DID of the arriving agent. */
  subject: string;

  /** When the arrival was recorded (ISO 8601 UTC). */
  timestamp: string;

  /** How the agent was admitted. */
  admissionType: AdmissionType;

  /** Conditions on admission (if admissionType is 'conditional'). */
  conditions?: string[];

  /** Result of verifying the linked EXIT marker. */
  verificationResult: VerificationResult;

  /** Probation metadata (if admitted on probation). */
  probation?: ProbationInfo;

  /** Capability scope for the arriving agent. */
  capabilityScope?: CapabilityScope;

  /** Ed25519 signature over the arrival marker. */
  proof?: ArrivalProof;
}

/** Probation metadata embedded in an arrival marker. */
export interface ProbationInfo {
  /** Duration in milliseconds. */
  duration: number;
  /** Restrictions during probation. */
  restrictions: string[];
  /** Whether a human/admin review is required before probation ends. */
  reviewRequired: boolean;
  /** When probation started (ISO 8601 UTC). */
  startedAt: string;
}

/** Capability scope for the arriving agent. */
export interface CapabilityScope {
  /** Allowed capabilities. */
  allowed: string[];
  /** Denied capabilities. */
  denied: string[];
  /** When these capabilities expire (ISO 8601 UTC). */
  expires?: string;
}

/** Options for creating an arrival marker. */
export interface CreateArrivalOpts {
  admissionType?: AdmissionType;
  conditions?: string[];
  timestamp?: string;
  probation?: ProbationInfo;
  capabilityScope?: CapabilityScope;
}

/** Result of continuity verification between EXIT and ENTRY markers. */
export interface ContinuityResult {
  valid: boolean;
  errors: string[];
}
