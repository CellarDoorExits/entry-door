import { describe, it, expect } from "vitest";
import {
  quickExit,
  quickExitP256,
  toJSON,
  generateIdentity,
  generateP256KeyPair,
  didFromP256PublicKey,
  createMarker,
  signMarker,
  ExitType,
  ExitStatus,
  type ExitMarker,
} from "cellar-door-exit";
import {
  verifyDeparture,
  verifyDepartureJSON,
  createArrivalMarker,
  signArrivalMarker,
  verifyArrivalMarker,
  verifyContinuity,
  quickEntry,
  ENTRY_CONTEXT_V1,
  quickEntryP256,
  // New modules
  evaluateAdmission,
  parseDuration,
  OPEN_DOOR,
  STRICT,
  EMERGENCY_ONLY,
  createProbationaryArrival,
  isProbationComplete,
  scopeFromExitMarker,
  createRestrictedScope,
  mergeScopes,
  InMemoryClaimStore,
  createRevocationMarker,
  verifyRevocationMarker,
  isRevoked,
  verifyTransfer,
  validateArrivalMarker,
  MAX_MARKER_SIZE,
  type AdmissionPolicy,
} from "../index.js";

async function makeSignedExit(origin = "https://platform-a.example.com") {
  return quickExit(origin);
}

function makeSignedExitWithType(exitType: ExitType, origin = "https://platform-a.example.com") {
  const identity = generateIdentity();
  const marker = createMarker({
    subject: identity.did,
    origin,
    exitType,
    ...(exitType === ExitType.Emergency ? { emergencyJustification: "Platform shutting down" } : {}),
  });
  return { marker: signMarker(marker, identity.privateKey, identity.publicKey), identity };
}

// ─── Original Tests ──────────────────────────────────────────────────────────

describe("verifyDeparture", () => {
  it("should verify a valid EXIT marker", async () => {
    const { marker } = await makeSignedExit();
    const result = verifyDeparture(marker);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("should reject a tampered EXIT marker", async () => {
    const { marker } = await makeSignedExit();
    const tampered = { ...marker, origin: "https://evil.example.com" };
    const result = verifyDeparture(tampered);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe("verifyDepartureJSON", () => {
  it("should parse and verify from JSON", async () => {
    const { marker } = await makeSignedExit();
    const json = toJSON(marker);
    const { result } = verifyDepartureJSON(json);
    expect(result.valid).toBe(true);
  });

  it("should reject invalid JSON", async () => {
    const { result } = verifyDepartureJSON("not json");
    expect(result.valid).toBe(false);
  });
});

describe("createArrivalMarker", () => {
  it("should create a linked arrival marker", async () => {
    const { marker: exit } = await makeSignedExit();
    const arrival = createArrivalMarker(exit, "https://platform-b.example.com");

    expect(arrival["@context"]).toBe(ENTRY_CONTEXT_V1);
    expect(arrival.departureRef).toBe(exit.id);
    expect(arrival.departureOrigin).toBe(exit.origin);
    expect(arrival.subject).toBe(exit.subject);
    expect(arrival.destination).toBe("https://platform-b.example.com");
    expect(arrival.verificationResult.valid).toBe(true);
    expect(arrival.admissionType).toBe("automatic");
    expect(arrival.id).toMatch(/^urn:entry:/);
  });

  it("should set reviewed admission for invalid exit markers", async () => {
    const { marker: exit } = await makeSignedExit();
    const tampered = { ...exit, origin: "https://evil.example.com" };
    const arrival = createArrivalMarker(tampered, "https://platform-b.example.com");
    expect(arrival.admissionType).toBe("reviewed");
    expect(arrival.verificationResult.valid).toBe(false);
  });

  it("should accept custom admission type and conditions", async () => {
    const { marker: exit } = await makeSignedExit();
    const arrival = createArrivalMarker(exit, "https://platform-b.example.com", {
      admissionType: "conditional",
      conditions: ["probation-30d", "limited-api-access"],
    });
    expect(arrival.admissionType).toBe("conditional");
    expect(arrival.conditions).toEqual(["probation-30d", "limited-api-access"]);
  });
});

describe("signArrivalMarker / verifyArrivalMarker", () => {
  it("should sign and verify an arrival marker", async () => {
    const { marker: exit } = await makeSignedExit();
    const arrival = createArrivalMarker(exit, "https://platform-b.example.com");
    const { publicKey, privateKey } = generateIdentity();
    const signed = signArrivalMarker(arrival, privateKey, publicKey);

    expect(signed.proof).toBeDefined();
    expect(signed.proof!.type).toBe("Ed25519Signature2020");

    const result = verifyArrivalMarker(signed);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("should reject tampered arrival marker", async () => {
    const { marker: exit } = await makeSignedExit();
    const arrival = createArrivalMarker(exit, "https://platform-b.example.com");
    const { publicKey, privateKey } = generateIdentity();
    const signed = signArrivalMarker(arrival, privateKey, publicKey);

    const tampered = { ...signed, destination: "https://evil.example.com" };
    const result = verifyArrivalMarker(tampered);
    expect(result.valid).toBe(false);
  });

  it("should reject unsigned arrival marker", async () => {
    const { marker: exit } = await makeSignedExit();
    const arrival = createArrivalMarker(exit, "https://platform-b.example.com");
    const result = verifyArrivalMarker(arrival);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing proof");
  });
});

describe("verifyContinuity", () => {
  it("should verify continuity between valid exit and arrival", async () => {
    const { marker: exit } = await makeSignedExit();
    const arrival = createArrivalMarker(exit, "https://platform-b.example.com");
    const result = verifyContinuity(exit, arrival);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("should reject mismatched departure reference", async () => {
    const { marker: exit } = await makeSignedExit();
    const arrival = createArrivalMarker(exit, "https://platform-b.example.com");
    const wrong = { ...arrival, departureRef: "urn:exit:wrong" };
    const result = verifyContinuity(exit, wrong);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Departure reference mismatch"))).toBe(true);
  });

  it("should reject mismatched subject DID", async () => {
    const { marker: exit } = await makeSignedExit();
    const arrival = createArrivalMarker(exit, "https://platform-b.example.com");
    const wrongSubject = { ...arrival, subject: "did:key:z6MkWRONG" };
    const result = verifyContinuity(exit, wrongSubject);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Subject mismatch"))).toBe(true);
  });

  it("should reject arrival before departure", async () => {
    const { marker: exit } = await makeSignedExit();
    const arrival = createArrivalMarker(exit, "https://platform-b.example.com", {
      timestamp: "2020-01-01T00:00:00.000Z",
    });
    const result = verifyContinuity(exit, arrival);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Temporal violation"))).toBe(true);
  });

  it("should reject mismatched origin", async () => {
    const { marker: exit } = await makeSignedExit();
    const arrival = createArrivalMarker(exit, "https://platform-b.example.com");
    const wrongOrigin = { ...arrival, departureOrigin: "https://wrong.example.com" };
    const result = verifyContinuity(exit, wrongOrigin);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Origin mismatch"))).toBe(true);
  });
});

describe("quickEntry", () => {
  it("should do full round-trip: exit → entry → verify continuity", async () => {
    const { marker: exit } = await makeSignedExit();
    const json = toJSON(exit);

    const result = quickEntry(json, "https://platform-b.example.com");

    expect(result.exitMarker.id).toBe(exit.id);
    expect(result.arrivalMarker.departureRef).toBe(exit.id);
    expect(result.arrivalMarker.proof).toBeDefined();
    expect(result.continuity.valid).toBe(true);
  });
});

describe("full lifecycle", () => {
  it("exit → arrive → sign → verify arrival → verify continuity", async () => {
    const identity = generateIdentity();
    const exitMarker = createMarker({
      subject: identity.did,
      origin: "https://platform-a.example.com",
      exitType: ExitType.Voluntary,
    });
    const signedExit = signMarker(exitMarker, identity.privateKey, identity.publicKey);

    const arrival = createArrivalMarker(signedExit, "https://platform-b.example.com");
    expect(arrival.verificationResult.valid).toBe(true);

    const destIdentity = generateIdentity();
    const signedArrival = signArrivalMarker(arrival, destIdentity.privateKey, destIdentity.publicKey);

    const arrivalVerified = verifyArrivalMarker(signedArrival);
    expect(arrivalVerified.valid).toBe(true);

    const continuity = verifyContinuity(signedExit, signedArrival);
    expect(continuity.valid).toBe(true);
  });
});

// ─── Admission Policy ────────────────────────────────────────────────────────

describe("admission-policy", () => {
  describe("parseDuration", () => {
    it("should parse various duration strings", async () => {
      expect(parseDuration("24h")).toBe(86_400_000);
      expect(parseDuration("7d")).toBe(604_800_000);
      expect(parseDuration("30m")).toBe(1_800_000);
      expect(parseDuration("10s")).toBe(10_000);
      expect(parseDuration("500ms")).toBe(500);
    });

    it("should pass through numbers", async () => {
      expect(parseDuration(42000)).toBe(42000);
    });

    it("should reject invalid format", async () => {
      expect(() => parseDuration("abc")).toThrow("Invalid duration");
    });
  });

  describe("OPEN_DOOR policy", () => {
    it("should admit a valid signed exit", async () => {
      const { marker } = await makeSignedExit();
      const result = evaluateAdmission(marker, OPEN_DOOR);
      expect(result.admitted).toBe(true);
    });

    it("should reject exit without proof", async () => {
      const { marker } = await makeSignedExit();
      const noProof = { ...marker, proof: undefined as any };
      const result = evaluateAdmission(noProof, OPEN_DOOR);
      expect(result.admitted).toBe(false);
      expect(result.reasons.some((r) => r.includes("no proof"))).toBe(true);
    });
  });

  describe("STRICT policy", () => {
    it("should reject non-voluntary exits", async () => {
      const { marker } = await makeSignedExitWithType(ExitType.Emergency);
      const result = evaluateAdmission(marker, STRICT);
      expect(result.admitted).toBe(false);
      expect(result.reasons.some((r) => r.includes("not in allowed types"))).toBe(true);
    });

    it("should reject old departures", async () => {
      const { marker } = await makeSignedExit();
      const oldTime = new Date(Date.now() - 2 * 86_400_000); // 2 days ago
      const oldMarker = { ...marker, timestamp: oldTime.toISOString() };
      const result = evaluateAdmission(oldMarker, STRICT);
      expect(result.admitted).toBe(false);
      expect(result.reasons.some((r) => r.includes("exceeds maximum"))).toBe(true);
    });

    it("should reject missing required modules", async () => {
      const { marker } = await makeSignedExitWithType(ExitType.Voluntary);
      const result = evaluateAdmission(marker, STRICT);
      expect(result.admitted).toBe(false);
      expect(result.reasons.some((r) => r.includes("Required module"))).toBe(true);
    });
  });

  describe("EMERGENCY_ONLY policy", () => {
    it("should admit emergency exits", async () => {
      const { marker } = await makeSignedExitWithType(ExitType.Emergency);
      const result = evaluateAdmission(marker, EMERGENCY_ONLY);
      expect(result.admitted).toBe(true);
    });

    it("should reject voluntary exits", async () => {
      const { marker } = await makeSignedExitWithType(ExitType.Voluntary);
      const result = evaluateAdmission(marker, EMERGENCY_ONLY);
      expect(result.admitted).toBe(false);
    });
  });

  describe("custom policies", () => {
    it("should compose multiple rules", async () => {
      const { marker } = await makeSignedExitWithType(ExitType.Emergency);
      const policy: AdmissionPolicy = {
        allowedExitTypes: ["voluntary"],
      };
      const result = evaluateAdmission(marker, policy);
      expect(result.admitted).toBe(false);
      expect(result.reasons.length).toBe(1);
    });
  });
});

// ─── Probation ───────────────────────────────────────────────────────────────

describe("probation", () => {
  it("should create a probationary arrival", async () => {
    const { marker: exit } = await makeSignedExit();
    const arrival = createProbationaryArrival(exit, "https://platform-b.example.com", {
      duration: 30 * 86_400_000, // 30 days
      restrictions: ["no-api-write", "limited-storage"],
      reviewRequired: true,
    });

    expect(arrival.admissionType).toBe("conditional");
    expect(arrival.probation).toBeDefined();
    expect(arrival.probation!.duration).toBe(30 * 86_400_000);
    expect(arrival.probation!.restrictions).toEqual(["no-api-write", "limited-storage"]);
    expect(arrival.probation!.reviewRequired).toBe(true);
    expect(arrival.conditions).toBeDefined();
    expect(arrival.conditions!.some((c) => c.startsWith("probation-"))).toBe(true);
  });

  it("should detect incomplete probation", async () => {
    const { marker: exit } = await makeSignedExit();
    const now = new Date("2026-01-15T00:00:00Z");
    const arrival = createProbationaryArrival(
      exit,
      "https://platform-b.example.com",
      { duration: 30 * 86_400_000, restrictions: [], reviewRequired: false },
      { timestamp: now.toISOString() }
    );

    // Check 10 days later — not complete
    const tenDaysLater = new Date("2026-01-25T00:00:00Z");
    expect(isProbationComplete(arrival, tenDaysLater)).toBe(false);
  });

  it("should detect completed probation", async () => {
    const { marker: exit } = await makeSignedExit();
    const now = new Date("2026-01-15T00:00:00Z");
    const arrival = createProbationaryArrival(
      exit,
      "https://platform-b.example.com",
      { duration: 30 * 86_400_000, restrictions: [], reviewRequired: false },
      { timestamp: now.toISOString() }
    );

    const thirtyOneDaysLater = new Date("2026-02-15T00:00:00Z");
    expect(isProbationComplete(arrival, thirtyOneDaysLater)).toBe(true);
  });

  it("should treat no-probation arrivals as complete", async () => {
    const { marker: exit } = await makeSignedExit();
    const arrival = createArrivalMarker(exit, "https://platform-b.example.com");
    expect(isProbationComplete(arrival)).toBe(true);
  });
});

// ─── Capability Scope ────────────────────────────────────────────────────────

describe("capability-scope", () => {
  it("should derive capabilities from exit marker with no modules", async () => {
    const { marker } = await makeSignedExit();
    const scope = scopeFromExitMarker(marker);
    expect(scope.allowed).toContain("basic-interaction");
    expect(scope.denied).toEqual([]);
  });

  it("should derive capabilities from exit marker with lineage module", async () => {
    const identity = generateIdentity();
    const marker = createMarker({
      subject: identity.did,
      origin: "https://platform-a.example.com",
      exitType: ExitType.Voluntary,
    });
    // Add lineage module
    (marker as any).lineage = { predecessor: "urn:exit:prev" };
    const signed = signMarker(marker, identity.privateKey, identity.publicKey);
    const scope = scopeFromExitMarker(signed);
    expect(scope.allowed).toContain("identity-continuity");
    expect(scope.allowed).toContain("basic-interaction");
  });

  it("should create restricted scope", async () => {
    const scope = createRestrictedScope(["read"], ["write", "delete"], "2026-12-31T00:00:00Z");
    expect(scope.allowed).toEqual(["read"]);
    expect(scope.denied).toEqual(["write", "delete"]);
    expect(scope.expires).toBe("2026-12-31T00:00:00Z");
  });

  it("should merge scopes with denied-wins semantics", async () => {
    const a = createRestrictedScope(["read", "write"], [], "2026-12-31T00:00:00Z");
    const b = createRestrictedScope(["execute"], ["write"], "2026-06-15T00:00:00Z");
    const merged = mergeScopes(a, b);
    expect(merged.allowed).toContain("read");
    expect(merged.allowed).toContain("execute");
    expect(merged.allowed).not.toContain("write");
    expect(merged.denied).toContain("write");
    expect(merged.expires).toBe("2026-06-15T00:00:00Z"); // earlier
  });

  it("should handle merge with no expiry", async () => {
    const a = createRestrictedScope(["a"], []);
    const b = createRestrictedScope(["b"], []);
    const merged = mergeScopes(a, b);
    expect(merged.expires).toBeUndefined();
  });

  it("should handle merge with one expiry", async () => {
    const a = createRestrictedScope(["a"], [], "2026-12-31T00:00:00Z");
    const b = createRestrictedScope(["b"], []);
    const merged = mergeScopes(a, b);
    expect(merged.expires).toBe("2026-12-31T00:00:00Z");
  });
});

// ─── Claim Tracking ──────────────────────────────────────────────────────────

describe("claim-tracking", () => {
  it("should claim a departure successfully", async () => {
    const store = new InMemoryClaimStore();
    expect(await store.claim("exit-1", "arrival-1")).toBe(true);
    expect(await store.isClaimed("exit-1")).toBe(true);
  });

  it("should reject double-claiming", async () => {
    const store = new InMemoryClaimStore();
    await store.claim("exit-1", "arrival-1");
    expect(await store.claim("exit-1", "arrival-2")).toBe(false);
  });

  it("should track arrival ID for a claim", async () => {
    const store = new InMemoryClaimStore();
    await store.claim("exit-1", "arrival-1");
    expect(await store.getArrivalId("exit-1")).toBe("arrival-1");
  });

  it("should return undefined for unclaimed", async () => {
    const store = new InMemoryClaimStore();
    expect(await store.getArrivalId("exit-1")).toBeUndefined();
    expect(await store.isClaimed("exit-1")).toBe(false);
  });

  it("should revoke and allow reclaim", async () => {
    const store = new InMemoryClaimStore();
    await store.claim("exit-1", "arrival-1");
    expect(await store.revoke("arrival-1")).toBe(true);
    expect(await store.isClaimed("exit-1")).toBe(false);
    // Can reclaim
    expect(await store.claim("exit-1", "arrival-2")).toBe(true);
  });

  it("should return false when revoking non-existent arrival", async () => {
    const store = new InMemoryClaimStore();
    expect(await store.revoke("nonexistent")).toBe(false);
  });

  it("should track size", async () => {
    const store = new InMemoryClaimStore();
    expect(store.size).toBe(0);
    await store.claim("exit-1", "arrival-1");
    await store.claim("exit-2", "arrival-2");
    expect(store.size).toBe(2);
  });

  it("should clear all claims", async () => {
    const store = new InMemoryClaimStore();
    await store.claim("exit-1", "arrival-1");
    await store.claim("exit-2", "arrival-2");
    store.clear();
    expect(store.size).toBe(0);
    expect(await store.isClaimed("exit-1")).toBe(false);
  });

  it("should delete claims by subject DID (GDPR)", async () => {
    const store = new InMemoryClaimStore();
    await store.claim("exit-1", "arrival-1", "did:key:z6MkAlice");
    await store.claim("exit-2", "arrival-2", "did:key:z6MkAlice");
    await store.claim("exit-3", "arrival-3", "did:key:z6MkBob");
    expect(await store.deleteBySubject("did:key:z6MkAlice")).toBe(2);
    expect(await store.isClaimed("exit-1")).toBe(false);
    expect(await store.isClaimed("exit-2")).toBe(false);
    expect(await store.isClaimed("exit-3")).toBe(true);
  });

  it("should return 0 when deleting unknown subject", async () => {
    const store = new InMemoryClaimStore();
    expect(await store.deleteBySubject("did:key:z6MkNobody")).toBe(0);
  });
});

// ─── Revocation ──────────────────────────────────────────────────────────────

describe("revocation", () => {
  it("should create and verify a revocation marker with authority", async () => {
    const { marker: exit } = await makeSignedExit();
    const arrival = createArrivalMarker(exit, "https://platform-b.example.com");
    const dest = generateIdentity();
    const signedArrival = signArrivalMarker(arrival, dest.privateKey, dest.publicKey);

    const revocation = createRevocationMarker(signedArrival, "fraud detected", dest.privateKey, dest.publicKey);
    expect(revocation.arrivalRef).toBe(signedArrival.id);
    expect(revocation.reason).toBe("fraud detected");
    expect(revocation.authority).toBeDefined();

    const verified = verifyRevocationMarker(revocation);
    expect(verified.valid).toBe(true);

    // Also verify against the arrival marker
    const verifiedWithArrival = verifyRevocationMarker(revocation, signedArrival);
    expect(verifiedWithArrival.valid).toBe(true);
  });

  it("should reject revocation by non-authority", async () => {
    const { marker: exit } = await makeSignedExit();
    const arrival = createArrivalMarker(exit, "https://platform-b.example.com");
    const dest = generateIdentity();
    const signedArrival = signArrivalMarker(arrival, dest.privateKey, dest.publicKey);

    // Try to revoke with a different identity
    const attacker = generateIdentity();
    expect(() =>
      createRevocationMarker(signedArrival, "malicious revoke", attacker.privateKey, attacker.publicKey)
    ).toThrow("Authority mismatch");
  });

  it("should detect tampered revocation", async () => {
    const { marker: exit } = await makeSignedExit();
    const arrival = createArrivalMarker(exit, "https://platform-b.example.com");
    const dest = generateIdentity();
    const signedArrival = signArrivalMarker(arrival, dest.privateKey, dest.publicKey);

    const revocation = createRevocationMarker(signedArrival, "fraud", dest.privateKey, dest.publicKey);
    const tampered = { ...revocation, reason: "not fraud" };
    const verified = verifyRevocationMarker(tampered);
    expect(verified.valid).toBe(false);
  });

  it("should check isRevoked", async () => {
    const { marker: exit } = await makeSignedExit();
    const arrival = createArrivalMarker(exit, "https://platform-b.example.com");
    const dest = generateIdentity();
    const signedArrival = signArrivalMarker(arrival, dest.privateKey, dest.publicKey);

    const revocation = createRevocationMarker(signedArrival, "banned", dest.privateKey, dest.publicKey);
    expect(isRevoked(signedArrival.id, [revocation])).toBe(true);
    expect(isRevoked(signedArrival.id, [])).toBe(false);
    expect(isRevoked("other-id", [revocation])).toBe(false);
  });

  it("should reject revocation without proof", async () => {
    const result = verifyRevocationMarker({ proof: undefined } as any);
    expect(result.valid).toBe(false);
  });

  it("should create and verify a P-256 revocation marker", async () => {
    const { marker: exit } = await makeSignedExit();
    const arrival = createArrivalMarker(exit, "https://platform-b.example.com");
    const { publicKey, privateKey } = generateP256KeyPair();
    const signedArrival = signArrivalMarker(arrival, privateKey, publicKey, "P-256");

    const revocation = createRevocationMarker(signedArrival, "policy violation", privateKey, publicKey, "P-256");
    expect(revocation.proof.type).toBe("EcdsaP256Signature2019");
    expect(revocation.arrivalRef).toBe(signedArrival.id);

    const verified = verifyRevocationMarker(revocation);
    expect(verified.valid).toBe(true);
  });
});

// ─── Transfer ────────────────────────────────────────────────────────────────

describe("transfer", () => {
  it("should verify a complete valid transfer", async () => {
    const { marker: exit } = await makeSignedExit();
    const arrival = createArrivalMarker(exit, "https://platform-b.example.com");
    const dest = generateIdentity();
    const signedArrival = signArrivalMarker(arrival, dest.privateKey, dest.publicKey);

    const record = verifyTransfer(exit, signedArrival);
    expect(record.verified).toBe(true);
    expect(record.errors).toEqual([]);
    expect(record.transferTime).toBeGreaterThanOrEqual(0);
    expect(record.continuity.valid).toBe(true);
  });

  it("should detect tampered exit marker", async () => {
    const { marker: exit } = await makeSignedExit();
    const arrival = createArrivalMarker(exit, "https://platform-b.example.com");
    const dest = generateIdentity();
    const signedArrival = signArrivalMarker(arrival, dest.privateKey, dest.publicKey);

    const tamperedExit = { ...exit, origin: "https://evil.example.com" };
    const record = verifyTransfer(tamperedExit, signedArrival);
    expect(record.verified).toBe(false);
    expect(record.errors.some((e) => e.startsWith("EXIT:"))).toBe(true);
  });

  it("should detect tampered arrival marker", async () => {
    const { marker: exit } = await makeSignedExit();
    const arrival = createArrivalMarker(exit, "https://platform-b.example.com");
    const dest = generateIdentity();
    const signedArrival = signArrivalMarker(arrival, dest.privateKey, dest.publicKey);

    const tamperedArrival = { ...signedArrival, destination: "https://evil.example.com" };
    const record = verifyTransfer(exit, tamperedArrival);
    expect(record.verified).toBe(false);
    expect(record.errors.some((e) => e.startsWith("ARRIVAL:"))).toBe(true);
  });

  it("should detect mismatched subjects in transfer", async () => {
    const { marker: exit } = await makeSignedExit();
    const arrival = createArrivalMarker(exit, "https://platform-b.example.com");
    const dest = generateIdentity();
    const signedArrival = signArrivalMarker(arrival, dest.privateKey, dest.publicKey);

    const wrongSubject = { ...signedArrival, subject: "did:key:z6MkWRONG" };
    // Re-sign with different subject would break signature, so just check continuity errors
    const record = verifyTransfer(exit, wrongSubject);
    expect(record.verified).toBe(false);
  });

  it("should detect unsigned arrival in transfer", async () => {
    const { marker: exit } = await makeSignedExit();
    const arrival = createArrivalMarker(exit, "https://platform-b.example.com");
    const record = verifyTransfer(exit, arrival);
    expect(record.verified).toBe(false);
    expect(record.errors.some((e) => e.includes("ARRIVAL:"))).toBe(true);
  });
});

// ─── Validation ──────────────────────────────────────────────────────────────

describe("validation", () => {
  it("should validate a correct arrival marker", async () => {
    const { marker: exit } = await makeSignedExit();
    const arrival = createArrivalMarker(exit, "https://platform-b.example.com");
    const result = validateArrivalMarker(arrival);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("should reject null", async () => {
    const result = validateArrivalMarker(null);
    expect(result.valid).toBe(false);
  });

  it("should reject non-object", async () => {
    const result = validateArrivalMarker("string");
    expect(result.valid).toBe(false);
  });

  it("should reject wrong context", async () => {
    const { marker: exit } = await makeSignedExit();
    const arrival = createArrivalMarker(exit, "https://platform-b.example.com");
    const wrong = { ...arrival, "@context": "wrong" };
    const result = validateArrivalMarker(wrong);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("@context"))).toBe(true);
  });

  it("should reject invalid id format", async () => {
    const { marker: exit } = await makeSignedExit();
    const arrival = createArrivalMarker(exit, "https://platform-b.example.com");
    const wrong = { ...arrival, id: "not-a-urn" };
    const result = validateArrivalMarker(wrong);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("id"))).toBe(true);
  });

  it("should reject invalid subject DID", async () => {
    const { marker: exit } = await makeSignedExit();
    const arrival = createArrivalMarker(exit, "https://platform-b.example.com");
    const wrong = { ...arrival, subject: "not-a-did" };
    const result = validateArrivalMarker(wrong);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("subject DID"))).toBe(true);
  });

  it("should reject invalid timestamp", async () => {
    const { marker: exit } = await makeSignedExit();
    const arrival = createArrivalMarker(exit, "https://platform-b.example.com");
    const wrong = { ...arrival, timestamp: "not-a-date" };
    const result = validateArrivalMarker(wrong);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("timestamp"))).toBe(true);
  });

  it("should reject invalid admissionType", async () => {
    const { marker: exit } = await makeSignedExit();
    const arrival = createArrivalMarker(exit, "https://platform-b.example.com");
    const wrong = { ...arrival, admissionType: "invalid" };
    const result = validateArrivalMarker(wrong);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("admissionType"))).toBe(true);
  });

  it("should reject missing verificationResult", async () => {
    const { marker: exit } = await makeSignedExit();
    const arrival = createArrivalMarker(exit, "https://platform-b.example.com");
    const wrong = { ...arrival, verificationResult: undefined };
    const result = validateArrivalMarker(wrong);
    expect(result.valid).toBe(false);
  });

  it("should reject oversized marker", async () => {
    const { marker: exit } = await makeSignedExit();
    const arrival = createArrivalMarker(exit, "https://platform-b.example.com");
    // Add a huge field
    const huge = { ...arrival, _padding: "x".repeat(MAX_MARKER_SIZE + 1) };
    const result = validateArrivalMarker(huge);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("exceeds maximum size"))).toBe(true);
  });

  it("should reject non-string conditions", async () => {
    const { marker: exit } = await makeSignedExit();
    const arrival = createArrivalMarker(exit, "https://platform-b.example.com");
    const wrong = { ...arrival, conditions: [123] };
    const result = validateArrivalMarker(wrong);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("conditions"))).toBe(true);
  });

  it("should accept marker with conditions", async () => {
    const { marker: exit } = await makeSignedExit();
    const arrival = createArrivalMarker(exit, "https://platform-b.example.com", {
      admissionType: "conditional",
      conditions: ["probation"],
    });
    const result = validateArrivalMarker(arrival);
    expect(result.valid).toBe(true);
  });

  it("should reject missing departureRef", async () => {
    const { marker: exit } = await makeSignedExit();
    const arrival = createArrivalMarker(exit, "https://platform-b.example.com");
    const wrong = { ...arrival, departureRef: "" };
    const result = validateArrivalMarker(wrong);
    expect(result.valid).toBe(false);
  });

  it("should reject missing destination", async () => {
    const { marker: exit } = await makeSignedExit();
    const arrival = createArrivalMarker(exit, "https://platform-b.example.com");
    const wrong = { ...arrival, destination: "" };
    const result = validateArrivalMarker(wrong);
    expect(result.valid).toBe(false);
  });
});

// ─── Integration: Full Pipeline ──────────────────────────────────────────────

describe("full pipeline: exit → admit → enter → verify → transfer", () => {
  it("should complete the entire flow", async () => {
    // 1. Agent exits
    const { marker: exit } = await makeSignedExit();

    // 2. Evaluate admission
    const admission = evaluateAdmission(exit, OPEN_DOOR);
    expect(admission.admitted).toBe(true);

    // 3. Derive capabilities
    const scope = scopeFromExitMarker(exit);

    // 4. Create arrival with capability scope
    const arrival = createArrivalMarker(exit, "https://platform-b.example.com", {
      capabilityScope: scope,
    });

    // 5. Sign arrival
    const dest = generateIdentity();
    const signed = signArrivalMarker(arrival, dest.privateKey, dest.publicKey);

    // 6. Claim the departure
    const store = new InMemoryClaimStore();
    expect(await store.claim(exit.id, signed.id)).toBe(true);

    // 7. Verify transfer
    const transfer = verifyTransfer(exit, signed);
    expect(transfer.verified).toBe(true);

    // 8. Validate the marker
    const validation = validateArrivalMarker(signed);
    expect(validation.valid).toBe(true);
  });

  it("should handle probationary admission pipeline", async () => {
    const { marker: exit } = await makeSignedExit();

    const arrival = createProbationaryArrival(
      exit,
      "https://platform-b.example.com",
      { duration: 86_400_000, restrictions: ["read-only"], reviewRequired: true }
    );

    expect(arrival.probation).toBeDefined();
    expect(isProbationComplete(arrival)).toBe(false);

    const dest = generateIdentity();
    const signed = signArrivalMarker(arrival, dest.privateKey, dest.publicKey);

    const transfer = verifyTransfer(exit, signed);
    expect(transfer.verified).toBe(true);
  });

  it("should handle revocation in pipeline", async () => {
    const { marker: exit } = await makeSignedExit();
    const arrival = createArrivalMarker(exit, "https://platform-b.example.com");
    const dest = generateIdentity();
    const signed = signArrivalMarker(arrival, dest.privateKey, dest.publicKey);

    // Claim
    const store = new InMemoryClaimStore();
    await store.claim(exit.id, signed.id);

    // Revoke
    const revocation = createRevocationMarker(signed, "policy violation", dest.privateKey, dest.publicKey);
    expect(isRevoked(signed.id, [revocation])).toBe(true);

    // Unclaim via revocation
    await store.revoke(signed.id);
    expect(await store.isClaimed(exit.id)).toBe(false);
  });
});

// ─── P-256 Algorithm Support (ENTRY-02) ──────────────────────────────────────

describe("P-256 algorithm support", () => {
  it("should sign and verify an arrival marker with P-256", async () => {
    const { marker: exit } = await makeSignedExit();
    const arrival = createArrivalMarker(exit, "https://platform-b.example.com");
    const { publicKey, privateKey } = generateP256KeyPair();
    const signed = signArrivalMarker(arrival, privateKey, publicKey, "P-256");

    expect(signed.proof).toBeDefined();
    expect(signed.proof!.type).toBe("EcdsaP256Signature2019");

    const result = verifyArrivalMarker(signed);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("should reject tampered P-256 arrival marker", async () => {
    const { marker: exit } = await makeSignedExit();
    const arrival = createArrivalMarker(exit, "https://platform-b.example.com");
    const { publicKey, privateKey } = generateP256KeyPair();
    const signed = signArrivalMarker(arrival, privateKey, publicKey, "P-256");

    const tampered = { ...signed, destination: "https://evil.example.com" };
    const result = verifyArrivalMarker(tampered);
    expect(result.valid).toBe(false);
  });

  it("quickEntry should support P-256 algorithm option", async () => {
    const { marker: exit } = await makeSignedExit();
    const json = toJSON(exit);

    const result = quickEntry(json, "https://platform-b.example.com", { algorithm: "P-256" });

    expect(result.arrivalMarker.proof).toBeDefined();
    expect(result.arrivalMarker.proof!.type).toBe("EcdsaP256Signature2019");
    expect(result.continuity.valid).toBe(true);
  });

  it("quickEntryP256 convenience should work", async () => {
    const { marker: exit } = await makeSignedExit();
    const json = toJSON(exit);

    const result = quickEntryP256(json, "https://platform-b.example.com");

    expect(result.arrivalMarker.proof).toBeDefined();
    expect(result.arrivalMarker.proof!.type).toBe("EcdsaP256Signature2019");
    expect(result.continuity.valid).toBe(true);
  });

  it.skip("should handle P-256 EXIT → P-256 ENTRY full pipeline (requires cellar-door-exit >=0.2.0)", async () => {
    const { marker: exit } = await quickExitP256("https://platform-a.example.com");
    const json = toJSON(exit);
    const result = quickEntryP256(json, "https://platform-b.example.com");

    expect(result.arrivalMarker.proof!.type).toBe("EcdsaP256Signature2019");
    expect(result.continuity.valid).toBe(true);

    const transfer = verifyTransfer(exit, result.arrivalMarker);
    expect(transfer.verified).toBe(true);
  });
});
