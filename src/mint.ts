/**
 * cellar-door-entry — Minting
 *
 * Create arrival markers for fresh agents with no departure history.
 */

import { admit, type AdmitOpts, type AdmitResult, type AdmissionRecord } from "./admit.js";
import type { BuiltPolicy } from "./policy-builder.js";
import type { AdmissionEventEmitter } from "./events.js";
import type { ClaimStore } from "./claim-tracking.js";

export interface MintOpts {
  /** DID of the agent being minted. */
  subjectDid: string;
  /** Destination platform. */
  destination?: string;
  /** Justification for minting. */
  justification?: string;
  /** Platform identity for signing. */
  platformIdentity?: { privateKey: Uint8Array; publicKey: Uint8Array };
  /** Policy to evaluate. */
  policy?: BuiltPolicy;
  /** Claim store. */
  store?: ClaimStore;
  /** Event emitter. */
  emitter?: AdmissionEventEmitter;
  /** Timestamp override. */
  timestamp?: string;
  /** Override admission type (e.g. "migration" for bulk). */
  admissionType?: "standard" | "minted" | "migration";
}

export type MintResult = AdmitResult & {
  /** The minted agent's DID. */
  subjectDid: string;
};

/**
 * Mint a fresh agent — create an arrival marker with no departure history.
 * Governed by the policy engine (allowMinting must be enabled).
 */
export async function mintAgent(opts: MintOpts): Promise<MintResult> {
  const result = await admit(null, {
    platformIdentity: opts.platformIdentity,
    policy: opts.policy,
    store: opts.store,
    destination: opts.destination,
    emitter: opts.emitter,
    timestamp: opts.timestamp,
    mintingJustification: opts.justification,
    mintingSubject: opts.subjectDid,
    admissionType: opts.admissionType,
  });

  return { ...result, subjectDid: opts.subjectDid };
}

export interface BulkMintAgent {
  subjectDid: string;
  justification?: string;
}

export interface BulkMintResult {
  results: MintResult[];
  succeeded: number;
  failed: number;
}

/**
 * Batch mint multiple agents for migration scenarios.
 */
export async function bulkMint(
  agents: BulkMintAgent[],
  opts: Omit<MintOpts, "subjectDid" | "justification"> = {}
): Promise<BulkMintResult> {
  const results: MintResult[] = [];
  let succeeded = 0;
  let failed = 0;

  for (const agent of agents) {
    const result = await mintAgent({
      ...opts,
      subjectDid: agent.subjectDid,
      justification: agent.justification,
      admissionType: "migration",
    });
    results.push(result);
    if (result.admission.admitted) {
      succeeded++;
    } else {
      failed++;
    }
  }

  return { results, succeeded, failed };
}
