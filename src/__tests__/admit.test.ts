import { describe, it, expect, vi } from "vitest";
import {
  quickExit,
  quickCounterSign,
  generateIdentity,
  generateKeyPair,
  ExitType,
  StatusConfirmation,
  deriveStatusConfirmation,
  verifyCounterSignature,
} from "cellar-door-exit";
import { admit, type AdmitOpts } from "../admit.js";
import { quickAdmit } from "../convenience.js";
import { createPolicy, CAUTIOUS, REQUIRE_MUTUAL } from "../policy-builder.js";
import { InMemoryClaimStore } from "../claim-tracking.js";
import { AdmissionEventEmitter } from "../events.js";

async function makeExit(origin = "https://platform-a.example.com") {
  return (await quickExit(origin)).marker;
}

async function makeMutualExit(origin = "https://platform-a.example.com") {
  const { marker } = await quickExit(origin);
  return quickCounterSign(marker).marker;
}

describe("admit()", () => {
  describe("Mode 1: exit marker + counter-sign", () => {
    it("should counter-sign exit marker and create arrival", async () => {
      const exitMarker = await makeExit();
      const platformKp = generateKeyPair();
      const result = await admit(exitMarker, {
        platformIdentity: platformKp,
        policy: createPolicy("open").requireVerifiedDeparture().build(),
        destination: "https://destination.example.com",
      });

      expect(result.admission.admitted).toBe(true);
      expect(result.admission.counterSigned).toBe(true);
      expect(result.admission.counterSignMeaning).toBe("receipt_only");
      expect(result.arrivalMarker).toBeDefined();
      expect(result.arrivalMarker.destination).toBe("https://destination.example.com");
      expect(result.counterSignedExitMarker).toBeDefined();
      expect(result.counterSignedExitMarker!.dispute?.counterpartyAcks?.length).toBe(1);
    });

    it("should verify the counter-signature", async () => {
      const exitMarker = await makeExit();
      const platformKp = generateKeyPair();
      const result = await admit(exitMarker, {
        platformIdentity: platformKp,
        policy: createPolicy("o").requireVerifiedDeparture().build(),
      });

      const csResult = verifyCounterSignature(result.counterSignedExitMarker!, platformKp.publicKey);
      expect(csResult.valid).toBe(true);
    });

    it("should set counter-sign meaning", async () => {
      const exitMarker = await makeExit();
      const platformKp = generateKeyPair();
      const result = await admit(exitMarker, {
        platformIdentity: platformKp,
        counterSignMeaning: "terms_acknowledged",
        policy: createPolicy("o").defaultDecision("admit").build(),
      });
      expect(result.admission.counterSignMeaning).toBe("terms_acknowledged");
    });

    it("should sign the arrival marker", async () => {
      const exitMarker = await makeExit();
      const platformKp = generateKeyPair();
      const result = await admit(exitMarker, {
        platformIdentity: platformKp,
        policy: createPolicy("o").defaultDecision("admit").build(),
      });
      expect(result.arrivalMarker.proof).toBeDefined();
      expect(result.arrivalMarker.proof!.proofValue).toBeDefined();
    });
  });

  describe("Mode 2: exit marker, no counter-sign", () => {
    it("should create arrival without counter-signing", async () => {
      const exitMarker = await makeExit();
      const result = await admit(exitMarker, {
        policy: createPolicy("o").defaultDecision("admit").build(),
        counterSign: false,
      });

      expect(result.admission.admitted).toBe(true);
      expect(result.admission.counterSigned).toBe(false);
      expect(result.admission.counterSignMeaning).toBeUndefined();
      expect(result.arrivalMarker).toBeDefined();
    });

    it("should work without platformIdentity", async () => {
      const exitMarker = await makeExit();
      const result = await admit(exitMarker, {
        policy: createPolicy("o").defaultDecision("admit").build(),
      });

      expect(result.admission.admitted).toBe(true);
      expect(result.admission.counterSigned).toBe(false);
      expect(result.arrivalMarker.proof).toBeUndefined();
    });
  });

  describe("Mode 3: no exit marker (minting)", () => {
    it("should mint when policy allows", async () => {
      const policy = createPolicy("mint-ok").allowMinting().build();
      const result = await admit(null, { policy, mintingSubject: "did:key:z6MkTest" });

      expect(result.admission.admitted).toBe(true);
      expect(result.admission.admissionType).toBe("minted");
      expect(result.admission.exitMarkerId).toBeUndefined();
      expect(result.arrivalMarker).toBeDefined();
      expect(result.arrivalMarker!.subject).toBe("did:key:z6MkTest");
    });

    it("should require mintingSubject when minting", async () => {
      const policy = createPolicy("mint-ok").allowMinting().build();
      await expect(admit(null, { policy })).rejects.toThrow("mintingSubject is required");
    });

    it("should reject minting when policy requires justification", async () => {
      const result = await admit(null, { policy: CAUTIOUS, mintingSubject: "did:key:z6MkTest" });
      expect(result.admission.admitted).toBe(false);
    });
  });

  describe("policy evaluation", () => {
    it("should reject based on policy", async () => {
      const exitMarker = await makeExit(); // self-only
      const result = await admit(exitMarker, { policy: REQUIRE_MUTUAL });
      expect(result.admission.admitted).toBe(false);
      expect(result.admission.reasonCodes.length).toBeGreaterThan(0);
    });

    it("should admit mutual markers with REQUIRE_MUTUAL", async () => {
      const exitMarker = await makeMutualExit();
      const platformKp = generateKeyPair();
      const result = await admit(exitMarker, {
        platformIdentity: platformKp,
        policy: REQUIRE_MUTUAL,
      });
      expect(result.admission.admitted).toBe(true);
    });

    it("should apply CAUTIOUS probation for self-only", async () => {
      const exitMarker = await makeExit();
      const result = await admit(exitMarker, { policy: CAUTIOUS });
      expect(result.admission.admitted).toBe(true);
      expect(result.admission.conditions).toContain("probation");
    });

    it("should detect quarantine conditions", async () => {
      let exitMarker = await makeExit();
      (exitMarker as any).dispute = { disputes: [{ id: "d1", challenger: "x", claim: "test" }] };
      // Use a policy with quarantine rules but without requireVerifiedDeparture,
      // since mutating the marker after signing invalidates its proof.
      const quarantinePolicy = createPolicy("quarantine-test")
        .onDisputed("quarantine", { maxDuration: "7d", reviewRequired: true })
        .defaultDecision("admit")
        .build();
      const result = await admit(exitMarker, { policy: quarantinePolicy });
      expect(result.admission.quarantined).toBe(true);
      expect(result.admission.quarantineExpires).toBeDefined();
    });
  });

  describe("claim store integration", () => {
    it("should store claims", async () => {
      const store = new InMemoryClaimStore();
      const exitMarker = await makeExit();
      const result = await admit(exitMarker, {
        policy: createPolicy("o").defaultDecision("admit").build(),
        store,
      });
      expect(result.admission.admitted).toBe(true);
      const claimed = await store.isClaimed(exitMarker.id);
      expect(claimed).toBe(true);
    });

    it("should store claims for minting (replay protection)", async () => {
      const store = new InMemoryClaimStore();
      const result = await admit(null, {
        policy: createPolicy("o").allowMinting().build(),
        store,
        mintingSubject: "did:key:z6MkTest",
      });
      expect(store.size).toBe(1);
      // The arrival marker ID is used as the claim key for minted markers
      expect(await store.isClaimed(result.arrivalMarker!.id)).toBe(true);
    });
  });

  describe("event emission", () => {
    it("should emit agent:admitted", async () => {
      const emitter = new AdmissionEventEmitter();
      const handler = vi.fn();
      emitter.on("agent:admitted", handler);
      const exitMarker = await makeExit();
      await admit(exitMarker, {
        policy: createPolicy("o").defaultDecision("admit").build(),
        emitter,
      });
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("should emit agent:rejected", async () => {
      const emitter = new AdmissionEventEmitter();
      const handler = vi.fn();
      emitter.on("agent:rejected", handler);
      const exitMarker = await makeExit();
      await admit(exitMarker, { policy: REQUIRE_MUTUAL, emitter });
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("should emit agent:quarantined", async () => {
      const emitter = new AdmissionEventEmitter();
      const handler = vi.fn();
      emitter.on("agent:quarantined", handler);
      let exitMarker = await makeExit();
      (exitMarker as any).dispute = { disputes: [{ id: "d1", challenger: "x", claim: "test" }] };
      const quarantinePolicy = createPolicy("quarantine-test")
        .onDisputed("quarantine", { maxDuration: "7d", reviewRequired: true })
        .defaultDecision("admit")
        .build();
      await admit(exitMarker, { policy: quarantinePolicy, emitter });
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("should emit agent:minted", async () => {
      const emitter = new AdmissionEventEmitter();
      const handler = vi.fn();
      emitter.on("agent:minted", handler);
      await admit(null, {
        policy: createPolicy("o").allowMinting().build(),
        emitter,
        mintingSubject: "did:key:z6MkTest",
      });
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe("admission record", () => {
    it("should have all required fields", async () => {
      const exitMarker = await makeExit();
      const platformKp = generateKeyPair();
      const result = await admit(exitMarker, {
        platformIdentity: platformKp,
        policy: CAUTIOUS,
        counterSignMeaning: "terms_reviewed",
      });
      const r = result.admission;
      expect(r.id).toBeDefined();
      expect(r.exitMarkerId).toBe(exitMarker.id);
      expect(r.arrivalMarkerId).toBeDefined();
      expect(r.subjectDid).toBe(exitMarker.subject);
      expect(r.originDid).toBe(exitMarker.origin);
      expect(r.confirmationLevel).toBeDefined();
      expect(r.policyApplied).toBe("cautious");
      expect(r.policyVersion).toBeDefined();
      expect(r.admitted).toBe(true);
      expect(r.admissionType).toBe("standard");
      expect(r.counterSigned).toBe(true);
      expect(r.counterSignMeaning).toBe("terms_reviewed");
      expect(r.timestamp).toBeDefined();
    });

    it("should set admissionType to minted for minting", async () => {
      const result = await admit(null, {
        policy: createPolicy("o").allowMinting().build(),
        mintingSubject: "did:key:z6MkTest",
      });
      expect(result.admission.admissionType).toBe("minted");
    });
  });
});

describe("quickAdmit()", () => {
  it("should work with exit marker object", async () => {
    const exitMarker = await makeExit();
    const result = await quickAdmit(exitMarker);
    expect(result.admission.admitted).toBe(true);
    expect(result.admission.counterSigned).toBe(true);
  });

  it("should work with exit marker JSON string", async () => {
    const exitMarker = await makeExit();
    const result = await quickAdmit(JSON.stringify(exitMarker));
    expect(result.admission.admitted).toBe(true);
  });

  it("should work without exit marker (minting)", async () => {
    const result = await quickAdmit(null, {
      policy: createPolicy("o").allowMinting().build(),
      mintingSubject: "did:key:z6MkTest",
    });
    expect(result.admission.admitted).toBe(true);
    expect(result.admission.admissionType).toBe("minted");
  });

  it("should use CAUTIOUS policy by default", async () => {
    const exitMarker = await makeExit();
    const result = await quickAdmit(exitMarker);
    expect(result.admission.policyApplied).toBe("cautious");
  });

  it("should generate ephemeral identity", async () => {
    const exitMarker = await makeExit();
    const result = await quickAdmit(exitMarker);
    expect(result.arrivalMarker.proof).toBeDefined();
  });

  it("should accept custom policy", async () => {
    const exitMarker = await makeMutualExit();
    const result = await quickAdmit(exitMarker, { policy: REQUIRE_MUTUAL });
    expect(result.admission.admitted).toBe(true);
    expect(result.admission.policyApplied).toBe("require-mutual");
  });

  it("should support counterSign=false", async () => {
    const exitMarker = await makeExit();
    const result = await quickAdmit(exitMarker, { counterSign: false });
    expect(result.admission.counterSigned).toBe(false);
  });
});

describe("replay protection", () => {
  it("should reject replayed exit markers", async () => {
    const store = new InMemoryClaimStore();
    const exitMarker = await makeExit();
    const policy = createPolicy("o").defaultDecision("admit").build();

    // First admission succeeds
    const r1 = await admit(exitMarker, { policy, store });
    expect(r1.admission.admitted).toBe(true);

    // Second admission with same marker is rejected
    const r2 = await admit(exitMarker, { policy, store });
    expect(r2.admission.admitted).toBe(false);
    expect(r2.admission.reasonCodes).toContain("replay-detected");
    expect(r2.arrivalMarker).toBeNull();
  });
});

describe("auto-store admission records", () => {
  it("should auto-store admission when store has putAdmission", async () => {
    const { SqliteClaimStore } = await import("../sqlite-store.js");
    const store = new SqliteClaimStore(":memory:");
    await store.init();
    const exitMarker = await makeExit();
    const policy = createPolicy("o").requireVerifiedDeparture().build();

    await admit(exitMarker, { policy, store });
    const history = await store.getAdmissionHistory(exitMarker.subject);
    expect(history.length).toBe(1);
    expect(history[0].admitted).toBe(true);
    store.close();
  });
});

describe("minting justification passthrough", () => {
  it("should pass mintingJustification to policy context", async () => {
    const policy = createPolicy("mint-just")
      .allowMinting({ requireJustification: true })
      .build();

    // Without justification — rejected
    const r1 = await admit(null, { policy, mintingSubject: "did:key:z6MkTest" });
    expect(r1.admission.admitted).toBe(false);

    // With justification — admitted
    const r2 = await admit(null, { policy, mintingJustification: "bootstrapping", mintingSubject: "did:key:z6MkTest" });
    expect(r2.admission.admitted).toBe(true);
  });

  it("should generate UUID-based record IDs", async () => {
    const exitMarker = await makeExit();
    const identity = generateIdentity();
    const r = await admit(exitMarker, { platformIdentity: identity });
    expect(r.admission.id).toMatch(/^admission-[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it("should generate unique IDs across calls", async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const exitMarker = await makeExit();
      const r = await admit(exitMarker, {});
      ids.add(r.admission.id);
    }
    expect(ids.size).toBe(50);
  });

  it("should set mintingJustification on record before creation", async () => {
    const policy = createPolicy("mint-test").allowMinting({ requireJustification: true }).build();
    const r = await admit(null, { policy, mintingJustification: "bootstrap", mintingSubject: "did:key:z6MkTest" });
    expect(r.admission.admitted).toBe(true);
    expect(r.admission.mintingJustification).toBe("bootstrap");
  });

  it("should set minting subject on arrival marker before signing", async () => {
    const identity = generateIdentity();
    const policy = createPolicy("mint-test").allowMinting({ requireJustification: true }).build();
    const r = await admit(null, {
      policy,
      mintingJustification: "test",
      mintingSubject: "did:key:z6MkTest",
      platformIdentity: identity,
    });
    expect(r.admission.admitted).toBe(true);
    expect(r.arrivalMarker!.subject).toBe("did:key:z6MkTest");
  });

  describe("Cryptographic verification", () => {
    it("should reject a forged exit marker with fake proofValue", async () => {
      const exitMarker = await makeExit();
      // Forge the proof — field exists but signature is invalid
      const forged = {
        ...exitMarker,
        proof: { ...exitMarker.proof!, proofValue: "zFAKE_PROOF_VALUE_NOT_REAL" },
      };
      const policy = createPolicy("strict").requireVerifiedDeparture().build();
      const result = await admit(forged as any, { policy });
      expect(result.admission.admitted).toBe(false);
      expect(result.admission.reasonCodes).toContain("departure-verification-failed");
    });

    it("should reject a marker with tampered fields", async () => {
      const exitMarker = await makeExit();
      // Tamper with origin after signing — signature no longer valid
      const tampered = { ...exitMarker, origin: "https://evil.example.com" };
      const policy = createPolicy("strict").requireVerifiedDeparture().build();
      const result = await admit(tampered as any, { policy });
      expect(result.admission.admitted).toBe(false);
      expect(result.admission.reasonCodes).toContain("departure-verification-failed");
    });

    it("should admit a marker with valid proof when verification required", async () => {
      const exitMarker = await makeExit();
      const policy = createPolicy("strict").requireVerifiedDeparture().build();
      const result = await admit(exitMarker, { policy });
      expect(result.admission.admitted).toBe(true);
    });

    it("should admit an unverifiable marker when policy does not require verification", async () => {
      const exitMarker = await makeExit();
      const forged = {
        ...exitMarker,
        proof: { ...exitMarker.proof!, proofValue: "zFAKE" },
      };
      const policy = createPolicy("lax").defaultDecision("admit").build();
      const result = await admit(forged as any, { policy });
      // Policy doesn't require verification, so it admits despite bad proof
      expect(result.admission.admitted).toBe(true);
    });

    it("should strip forged counter-signatures from exit marker", async () => {
      const exitMarker = await makeExit();
      // Inject a fake counterpartyAck — not signed by any real key
      const forgedMarker = {
        ...exitMarker,
        dispute: {
          ...exitMarker.dispute,
          counterpartyAcks: [{
            type: "Ed25519Signature2020",
            created: new Date().toISOString(),
            verificationMethod: "did:key:z6MkgZjBLL4uAq3kyuhBgMb5nmNkysgHtuAoxC2cXzms6ZkK",
            proofValue: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          }],
        },
      };
      // With REQUIRE_MUTUAL, the forged ack should be stripped, leaving self_only → rejected
      const result = await admit(forgedMarker as any, { policy: REQUIRE_MUTUAL });
      expect(result.admission.admitted).toBe(false);
    });

    it("should preserve legitimate counter-signatures", async () => {
      const exitMarker = await makeMutualExit();
      // Legitimate counter-signed marker should pass REQUIRE_MUTUAL
      const result = await admit(exitMarker, { policy: REQUIRE_MUTUAL });
      expect(result.admission.admitted).toBe(true);
    });
  });

  describe("ADV-02: burn-on-reject DoS fix", () => {
    it("should release claim on policy rejection so marker can be re-presented", async () => {
      const exitMarker = await makeExit();
      const store = new InMemoryClaimStore();
      // Use REQUIRE_MUTUAL which will reject a self-only marker
      const result1 = await admit(exitMarker, { policy: REQUIRE_MUTUAL, store });
      expect(result1.admission.admitted).toBe(false);

      // The claim should have been released — marker can be re-presented
      // e.g. after policy changes to something more permissive
      const permissive = createPolicy("permissive").defaultDecision("admit").build();
      const result2 = await admit(exitMarker, { policy: permissive, store });
      expect(result2.admission.admitted).toBe(true);
    });

    it("should release claim on verification failure so marker can try elsewhere", async () => {
      const exitMarker = await makeExit();
      const store = new InMemoryClaimStore();
      // Create a policy that requires verified departure
      const strictVerify = createPolicy("strict-verify")
        .requireVerifiedDeparture()
        .defaultDecision("admit")
        .build();

      // Tamper with proof to make verification fail
      const tampered = JSON.parse(JSON.stringify(exitMarker));
      tampered.proof.proofValue = "A".repeat(88);

      const result1 = await admit(tampered, { policy: strictVerify, store });
      expect(result1.admission.admitted).toBe(false);
      expect(result1.admission.reasonCodes).toContain("departure-verification-failed");

      // Claim should be released — original valid marker can be presented
      const result2 = await admit(exitMarker, { policy: strictVerify, store });
      expect(result2.admission.admitted).toBe(true);
    });

    it("should NOT release claim on replay detection", async () => {
      const exitMarker = await makeExit();
      const store = new InMemoryClaimStore();
      const permissive = createPolicy("permissive").defaultDecision("admit").build();

      // First admission succeeds and permanently consumes the claim
      const result1 = await admit(exitMarker, { policy: permissive, store });
      expect(result1.admission.admitted).toBe(true);

      // Second attempt should be rejected as replay — claim stays consumed
      const result2 = await admit(exitMarker, { policy: permissive, store });
      expect(result2.admission.admitted).toBe(false);
      expect(result2.admission.reasonCodes).toContain("replay-detected");

      // Third attempt still rejected — claim was not released by replay rejection
      const result3 = await admit(exitMarker, { policy: permissive, store });
      expect(result3.admission.admitted).toBe(false);
      expect(result3.admission.reasonCodes).toContain("replay-detected");
    });
  });
});
