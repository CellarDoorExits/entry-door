/**
 * cellar-door-entry — Admit Ceremony
 *
 * The core admission ceremony: verify departure → evaluate policy →
 * optionally counter-sign → create arrival → store → emit events.
 */

import { createHash, randomUUID } from "node:crypto";
import {
  addCounterSignature,
  deriveStatusConfirmation,
  verifyCounterSignature,
  publicKeyFromDid,
  publicKeyFromP256Did,
  algorithmFromDid,
  StatusConfirmation,
  type ExitMarker,
} from "cellar-door-exit";
import { verifyDeparture } from "./verify-departure.js";
import { createArrivalMarker } from "./arrival.js";
import { signArrivalMarker } from "./sign.js";
import type { ArrivalMarker } from "./types.js";
import type { ClaimStore } from "./claim-tracking.js";
import type { BuiltPolicy } from "./policy-builder.js";
import { CAUTIOUS } from "./policy-builder.js";
import { parseDuration } from "./admission-policy.js";
import { AdmissionEventEmitter, type AdmissionEventType } from "./events.js";

/**
 * Meaning of a counter-signature on an exit marker.
 * - receipt_only: acknowledges receipt, no terms review
 * - terms_acknowledged: terms were acknowledged
 * - terms_reviewed: attestation that terms were reviewed (NOT a verification guarantee)
 */
export type CounterSignMeaning = "receipt_only" | "terms_acknowledged" | "terms_reviewed";

export interface AdmissionRecord {
  id: string;
  exitMarkerId?: string;
  arrivalMarkerId: string;
  subjectDid: string;
  originDid?: string;
  confirmationLevel?: StatusConfirmation;
  policyApplied: string;
  policyVersion: string;
  admitted: boolean;
  admissionType: "standard" | "minted" | "migration";
  counterSigned: boolean;
  counterSignMeaning?: CounterSignMeaning;
  reasonCodes: string[];
  conditions: string[];
  timestamp: string;
  quarantined?: boolean;
  quarantineExpires?: string;
  quarantineResolution?: "admitted" | "rejected" | "contested";
  mintingJustification?: string;
  retentionExpires?: string;
  contested?: boolean;
  contestReason?: string;
  policySnapshot?: string;
}

/**
 * Extended store interface that supports admission record storage.
 * Implementations (e.g. SqliteClaimStore) should implement this.
 */
export interface AdmissionStore extends ClaimStore {
  putAdmission(record: AdmissionRecord): Promise<void>;
  getAdmission?(id: string): Promise<AdmissionRecord | undefined>;
  getAdmissionHistory?(subjectDid: string): Promise<AdmissionRecord[]>;
}

/** Type guard: does the store support putAdmission? */
export function isAdmissionStore(store: ClaimStore): store is AdmissionStore {
  return typeof (store as AdmissionStore).putAdmission === "function";
}

export interface AdmitOpts {
  /** Platform identity for signing arrival and optionally counter-signing exit. */
  platformIdentity?: { privateKey: Uint8Array; publicKey: Uint8Array };
  /** Policy to evaluate. Defaults to CAUTIOUS. */
  policy?: BuiltPolicy;
  /** Claim store for replay protection. */
  store?: ClaimStore;
  /** Meaning of counter-signature. */
  counterSignMeaning?: CounterSignMeaning;
  /** Destination platform identifier. */
  destination?: string;
  /** Event emitter for admission events. */
  emitter?: AdmissionEventEmitter;
  /** Whether to counter-sign the exit marker. Defaults to true if platformIdentity is provided. */
  counterSign?: boolean;
  /** Timestamp override (for testing). */
  timestamp?: string;
  /** Justification for minting (required by some policies). */
  mintingJustification?: string;
  /** Subject DID for minted markers (set before signing). */
  mintingSubject?: string;
  /** Override admission type (e.g. "migration" for bulk minting). */
  admissionType?: "standard" | "minted" | "migration";
}

/** Successful admission result. */
export interface AdmitResultAdmitted {
  /** The exit marker, potentially with a counter-signature added. */
  counterSignedExitMarker?: ExitMarker;
  /** The created arrival marker. */
  arrivalMarker: ArrivalMarker;
  /** The admission record for audit. */
  admission: AdmissionRecord & { admitted: true };
}

/** Rejected admission result. */
export interface AdmitResultRejected {
  /** The exit marker, potentially with a counter-signature added. */
  counterSignedExitMarker?: ExitMarker;
  /** No arrival marker on rejection. */
  arrivalMarker: null;
  /** The admission record for audit. */
  admission: AdmissionRecord & { admitted: false };
}

export type AdmitResult = AdmitResultAdmitted | AdmitResultRejected;

function generateRecordId(): string {
  return `admission-${randomUUID()}`;
}

/** Persist a rejection record if the store supports it. */
async function persistRejection(record: AdmissionRecord, store?: ClaimStore): Promise<void> {
  if (store && isAdmissionStore(store)) {
    await store.putAdmission(record);
  }
}

function computePolicySnapshot(policy: BuiltPolicy): string | undefined {
  if (!policy.toJSON) return undefined;
  try { return JSON.stringify(policy.toJSON()); } catch { return undefined; }
}

function computePolicyVersion(policy: BuiltPolicy): string {
  try {
    const json = JSON.stringify(policy.toJSON());
    return createHash("sha256").update(json).digest("hex").slice(0, 16);
  } catch {
    return "unknown";
  }
}

/**
 * Admit an agent — the core ceremony.
 *
 * Three modes:
 * 1. With exit marker + counter-sign (platformIdentity provided)
 * 2. With exit marker, no counter-sign (no platformIdentity or counterSign=false)
 * 3. No exit marker — minting (exitMarker is null/undefined)
 */
export async function admit(
  exitMarkerInput: ExitMarker | null | undefined,
  opts: AdmitOpts = {}
): Promise<AdmitResult> {
  // Deep clone to prevent mutation of caller's exit marker during
  // counter-signature verification/stripping (panel finding #6).
  let exitMarker = exitMarkerInput ? JSON.parse(JSON.stringify(exitMarkerInput)) as ExitMarker : exitMarkerInput;
  const policy = opts.policy ?? CAUTIOUS;
  const destination = opts.destination ?? "https://destination.example.com";
  const timestamp = opts.timestamp ?? new Date().toISOString();
  const isMinting = !exitMarker;

  // Require mintingSubject for minting operations
  if (isMinting && !opts.mintingSubject) {
    throw new Error("mintingSubject is required when minting (no exit marker)");
  }

  // 0. Replay protection — atomically claim the exit marker.
  // Using claim() as both check-and-claim prevents TOCTOU races.
  // The claim is released if policy rejects, so the agent can try
  // again (e.g., after policy updates). Only successful admissions
  // permanently consume the claim.
  const pendingClaimId = `pending-${randomUUID()}`;
  if (opts.store && exitMarker) {
    const subjectDid = exitMarker.subject ?? "unknown";
    const claimed = await opts.store.claim(exitMarker.id, pendingClaimId, subjectDid);
    if (!claimed) {
      const record: AdmissionRecord = {
        id: generateRecordId(),
        exitMarkerId: exitMarker.id,
        arrivalMarkerId: "",
        subjectDid: exitMarker.subject ?? "unknown",
        originDid: exitMarker.origin,
        policyApplied: policy.name,
        policyVersion: computePolicyVersion(policy),
        admitted: false,
        admissionType: "standard",
        counterSigned: false,
        reasonCodes: ["replay-detected"],
        conditions: [],
        timestamp,
        policySnapshot: computePolicySnapshot(policy),
      };
      await persistRejection(record, opts.store);
      opts.emitter?.emit("agent:rejected", { record, exitMarkerId: exitMarker.id });
      return {
        counterSignedExitMarker: exitMarker,
        arrivalMarker: null,
        admission: record as AdmissionRecord & { admitted: false },
      } as AdmitResultRejected;
    }
  }

  // 0.5. Cryptographic verification of exit marker
  let verified = true;
  if (exitMarker) {
    const verificationResult = verifyDeparture(exitMarker);
    verified = verificationResult.valid;

    // If the marker has been counter-signed, the original proof covers
    // the pre-counter-sign payload.  Re-verify a stripped copy so that
    // legitimate counter-signatures don't trigger a false rejection.
    if (!verified && exitMarker.dispute?.counterpartyAcks?.length) {
      // Counter-signatures are added after the original proof, so the full
      // marker naturally fails verification. Strip counterpartyAcks and
      // re-verify to check the original content is legitimately signed.
      // NOTE: This proves the BASE marker was signed by its origin.
      // The counterpartyAcks themselves should be verified separately via
      // verifyCounterSignature() if counter-signature authenticity matters.
      const strippedDispute = { ...exitMarker.dispute };
      delete (strippedDispute as Record<string, unknown>).counterpartyAcks;
      const hasOtherDispute = Object.keys(strippedDispute).length > 0;
      const stripped: ExitMarker = hasOtherDispute
        ? { ...exitMarker, dispute: strippedDispute as ExitMarker["dispute"] }
        : ((): ExitMarker => { const { dispute: _, ...rest } = exitMarker; return rest as ExitMarker; })();
      const strippedResult = verifyDeparture(stripped);
      if (strippedResult.valid) verified = true;
    }

    // 0.6. Verify counter-signatures — strip any that fail verification.
    // This prevents forged counterpartyAcks from influencing policy decisions
    // (e.g., upgrading self_only to mutual via fake acks).
    if (exitMarker.dispute?.counterpartyAcks?.length) {
      const markerForVerify = exitMarker; // capture for closure narrowing
      const verifiedAcks = exitMarker.dispute.counterpartyAcks.filter((ack, i) => {
        try {
          // Parse public key based on DID algorithm
          const algo = algorithmFromDid(ack.verificationMethod);
          const pubKey = algo === "P-256"
            ? publicKeyFromP256Did(ack.verificationMethod)
            : publicKeyFromDid(ack.verificationMethod);
          const result = verifyCounterSignature(markerForVerify, pubKey, i);
          return result.valid;
        } catch {
          return false; // DID parse failure or unknown key type
        }
      });
      if (verifiedAcks.length !== exitMarker.dispute.counterpartyAcks.length) {
        // Replace marker with one containing only verified acks
        const cleanedDispute = { ...exitMarker.dispute };
        if (verifiedAcks.length > 0) {
          cleanedDispute.counterpartyAcks = verifiedAcks;
        } else {
          delete (cleanedDispute as Record<string, unknown>).counterpartyAcks;
        }
        // Only remove dispute entirely if no fields remain
        const remainingKeys = Object.keys(cleanedDispute).filter(k => cleanedDispute[k as keyof typeof cleanedDispute] !== undefined);
        if (remainingKeys.length === 0) {
          const { dispute: _, ...rest } = exitMarker;
          exitMarker = rest as ExitMarker;
        } else {
          exitMarker = { ...exitMarker, dispute: cleanedDispute as ExitMarker["dispute"] };
        }
      }
    }

    const policyRequiresVerification = policy.rules.some(r => r.name === "verified-departure");
    if (!verified && policyRequiresVerification) {
      // Hard reject: policy requires verified departure and marker is not verifiable
      const record: AdmissionRecord = {
        id: generateRecordId(),
        exitMarkerId: exitMarker.id,
        arrivalMarkerId: "",
        subjectDid: exitMarker.subject ?? "unknown",
        originDid: exitMarker.origin,
        policyApplied: policy.name,
        policyVersion: computePolicyVersion(policy),
        admitted: false,
        admissionType: "standard",
        counterSigned: false,
        reasonCodes: ["departure-verification-failed"],
        conditions: [],
        timestamp,
        policySnapshot: computePolicySnapshot(policy),
      };
      // Release pre-claim so marker can be re-presented
      if (opts.store) await opts.store.revoke(pendingClaimId).catch((e) => { if (typeof console !== 'undefined') console.warn('[cellar-door-entry] Failed to release pre-claim:', e); });
      await persistRejection(record, opts.store);
      opts.emitter?.emit("agent:rejected", { record, exitMarkerId: exitMarker.id });
      return {
        counterSignedExitMarker: exitMarker,
        arrivalMarker: null,
        admission: record as AdmissionRecord & { admitted: false },
      } as AdmitResultRejected;
    }
  }

  // 1. Evaluate policy
  const policyResult = policy.evaluate(exitMarker ?? null, {
    isMinting,
    now: new Date(timestamp),
    mintingJustification: opts.mintingJustification,
    verified,
  });

  if (!policyResult.admitted) {
    // Rejected
    const record: AdmissionRecord = {
      id: generateRecordId(),
      exitMarkerId: exitMarker?.id,
      arrivalMarkerId: "",
      subjectDid: exitMarker?.subject ?? "unknown",
      originDid: exitMarker?.origin,
      confirmationLevel: exitMarker ? deriveStatusConfirmation(exitMarker) : undefined,
      policyApplied: policy.name,
      policyVersion: computePolicyVersion(policy),
      admitted: false,
      admissionType: isMinting ? "minted" : "standard",
      counterSigned: false,
      reasonCodes: policyResult.reasons,
      conditions: policyResult.conditions,
      timestamp,
      policySnapshot: computePolicySnapshot(policy),
    };

    // Release pre-claim so marker can be re-presented after policy changes
    if (opts.store && exitMarker) await opts.store.revoke(pendingClaimId).catch((e) => { if (typeof console !== 'undefined') console.warn('[cellar-door-entry] Failed to release pre-claim:', e); });
    await persistRejection(record, opts.store);
    opts.emitter?.emit("agent:rejected", { record, exitMarkerId: exitMarker?.id });

    return {
      counterSignedExitMarker: exitMarker ?? undefined,
      arrivalMarker: null,
      admission: record as AdmissionRecord & { admitted: false },
    } as AdmitResultRejected;
  }

  // 2. Check for quarantine conditions
  const isQuarantined = policyResult.conditions.some((c) => c === "quarantine");
  let quarantineExpires: string | undefined;
  if (isQuarantined) {
    const maxDurCondition = policyResult.conditions.find((c) => c.startsWith("quarantine-max:"));
    if (maxDurCondition) {
      const durStr = maxDurCondition.split(":")[1];
      const ms = parseDuration(durStr);
      quarantineExpires = new Date(new Date(timestamp).getTime() + ms).toISOString();
    }
  }

  // 3. Counter-sign exit marker (if applicable)
  let counterSignedExit = exitMarker ?? undefined;
  let didCounterSign = false;
  if (exitMarker && opts.platformIdentity && (opts.counterSign !== false)) {
    counterSignedExit = addCounterSignature(
      exitMarker,
      opts.platformIdentity.privateKey,
      opts.platformIdentity.publicKey
    );
    didCounterSign = true;
  }

  // 4. Create arrival marker
  let arrivalMarker: ArrivalMarker;
  if (exitMarker) {
    arrivalMarker = createArrivalMarker(exitMarker, destination, {
      admissionType: isQuarantined ? "conditional" : "automatic",
      conditions: policyResult.conditions.length > 0 ? policyResult.conditions : undefined,
      timestamp,
    });
  } else {
    // Minting — create a synthetic arrival
    arrivalMarker = {
      "@context": "https://cellar-door.dev/entry/v1" as const,
      id: `urn:entry:minted-${randomUUID()}`,
      departureRef: "urn:entry:minted",
      departureOrigin: "urn:entry:minted",
      destination,
      subject: opts.mintingSubject!,
      timestamp,
      admissionType: "reviewed",
      verificationResult: { valid: false, errors: ["minted-no-departure"] },
    };
  }

  // 5. Sign arrival marker (if platform identity provided)
  if (opts.platformIdentity) {
    arrivalMarker = signArrivalMarker(
      arrivalMarker,
      opts.platformIdentity.privateKey,
      opts.platformIdentity.publicKey
    );
  }

  // 6. Update claim with real arrival marker ID (exit markers were pre-claimed in step 0)
  //    For minted markers, create a new claim for audit trail.
  if (opts.store) {
    if (isMinting) {
      const subjectDid = arrivalMarker.subject;
      await opts.store.claim(arrivalMarker.id, arrivalMarker.id, subjectDid);
    }
    // For exit markers, the claim was already atomically acquired in step 0.
    // The pending arrival ID could be updated here if the store supports it,
    // but the UNIQUE constraint on exit_marker_id already prevents replay.
  }

  // 7. Build admission record
  const record: AdmissionRecord = {
    id: generateRecordId(),
    exitMarkerId: exitMarker?.id,
    arrivalMarkerId: arrivalMarker.id,
    subjectDid: exitMarker?.subject ?? arrivalMarker.subject,
    originDid: exitMarker?.origin,
    confirmationLevel: exitMarker ? deriveStatusConfirmation(exitMarker) : undefined,
    policyApplied: policy.name,
    policyVersion: computePolicyVersion(policy),
    admitted: true,
    admissionType: opts.admissionType ?? (isMinting ? "minted" : "standard"),
    counterSigned: didCounterSign,
    counterSignMeaning: didCounterSign ? (opts.counterSignMeaning ?? "receipt_only") : undefined,
    reasonCodes: policyResult.reasons,
    conditions: policyResult.conditions,
    timestamp,
    quarantined: isQuarantined || undefined,
    quarantineExpires,
    mintingJustification: isMinting ? opts.mintingJustification : undefined,
    policySnapshot: computePolicySnapshot(policy),
  };

  // 8. Auto-store admission record
  if (opts.store && isAdmissionStore(opts.store)) {
    await opts.store.putAdmission(record);
  }

  // 9. Emit events
  if (opts.emitter) {
    if (isQuarantined) {
      opts.emitter.emit("agent:quarantined", { record });
    } else if (isMinting) {
      opts.emitter.emit("agent:minted", { record });
    } else {
      opts.emitter.emit("agent:admitted", { record });
    }
  }

  return {
    counterSignedExitMarker: counterSignedExit,
    arrivalMarker,
    admission: record as AdmissionRecord & { admitted: true },
  } as AdmitResultAdmitted;
}
