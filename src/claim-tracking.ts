/**
 * cellar-door-entry — Claim Tracking
 *
 * Tracks which EXIT markers have been claimed (used for arrival).
 * Prevents replay attacks by ensuring each departure is claimed at most once.
 */

/** Interface for claim storage backends. All methods are async to support Redis/DB with proper locking. */
export interface ClaimStore {
  claim(exitMarkerId: string, arrivalMarkerId: string): Promise<boolean>;
  isClaimed(exitMarkerId: string): Promise<boolean>;
  getArrivalId(exitMarkerId: string): Promise<string | undefined>;
  revoke(arrivalMarkerId: string): Promise<boolean>;
  /** GDPR Art. 17 — delete all claims involving a given subject DID. */
  deleteBySubject(subjectDid: string): Promise<number>;
}

/**
 * In-memory claim store (Map-based). For production, implement ClaimStore
 * with Redis, a database, or a distributed ledger with proper locking.
 */
export class InMemoryClaimStore implements ClaimStore {
  private claims = new Map<string, string>(); // exitMarkerId → arrivalMarkerId
  private reverseIndex = new Map<string, string>(); // arrivalMarkerId → exitMarkerId
  private subjectIndex = new Map<string, Set<string>>(); // subjectDid → Set<exitMarkerId>

  /**
   * Claim an EXIT marker for an arrival. Returns true if successful (unclaimed),
   * false if already claimed.
   */
  async claim(exitMarkerId: string, arrivalMarkerId: string, subjectDid?: string): Promise<boolean> {
    if (this.claims.has(exitMarkerId)) return false;
    this.claims.set(exitMarkerId, arrivalMarkerId);
    this.reverseIndex.set(arrivalMarkerId, exitMarkerId);
    if (subjectDid) {
      let set = this.subjectIndex.get(subjectDid);
      if (!set) {
        set = new Set();
        this.subjectIndex.set(subjectDid, set);
      }
      set.add(exitMarkerId);
    }
    return true;
  }

  /** Check if an EXIT marker has been claimed. */
  async isClaimed(exitMarkerId: string): Promise<boolean> {
    return this.claims.has(exitMarkerId);
  }

  /** Get the arrival marker ID that claimed this exit marker. */
  async getArrivalId(exitMarkerId: string): Promise<string | undefined> {
    return this.claims.get(exitMarkerId);
  }

  /**
   * Revoke an arrival, unclaiming the associated EXIT marker.
   * Returns true if found and revoked.
   */
  async revoke(arrivalMarkerId: string): Promise<boolean> {
    const exitId = this.reverseIndex.get(arrivalMarkerId);
    if (!exitId) return false;
    this.claims.delete(exitId);
    this.reverseIndex.delete(arrivalMarkerId);
    return true;
  }

  /**
   * GDPR Art. 17 — delete all claims involving a given subject DID.
   * Returns the number of claims deleted.
   */
  async deleteBySubject(subjectDid: string): Promise<number> {
    const exitIds = this.subjectIndex.get(subjectDid);
    if (!exitIds || exitIds.size === 0) return 0;
    let count = 0;
    for (const exitId of exitIds) {
      const arrivalId = this.claims.get(exitId);
      if (arrivalId) {
        this.reverseIndex.delete(arrivalId);
      }
      this.claims.delete(exitId);
      count++;
    }
    this.subjectIndex.delete(subjectDid);
    return count;
  }

  /** Number of active claims. */
  get size(): number {
    return this.claims.size;
  }

  /** Clear all claims. */
  clear(): void {
    this.claims.clear();
    this.reverseIndex.clear();
    this.subjectIndex.clear();
  }
}
