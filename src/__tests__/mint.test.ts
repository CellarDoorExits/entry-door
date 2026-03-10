import { describe, it, expect, vi } from "vitest";
import { generateKeyPair } from "cellar-door-exit";
import { mintAgent, bulkMint } from "../mint.js";
import { createPolicy, CAUTIOUS } from "../policy-builder.js";
import { AdmissionEventEmitter } from "../events.js";

describe("mintAgent()", () => {
  it("should mint an agent with allowMinting policy", async () => {
    const policy = createPolicy("mint-ok").allowMinting().build();
    const result = await mintAgent({
      subjectDid: "did:key:z6MkTest1",
      policy,
    });
    expect(result.admission.admitted).toBe(true);
    expect(result.admission.admissionType).toBe("minted");
    expect(result.subjectDid).toBe("did:key:z6MkTest1");
    expect(result.admission.subjectDid).toBe("did:key:z6MkTest1");
  });

  it("should reject minting when policy denies", async () => {
    const policy = createPolicy("no-mint").build();
    // No minting rule → abstains → default admit. Need explicit deny:
    const policy2 = createPolicy("no-mint")
      .custom("deny-all-minting", (_m, ctx) => {
        if (ctx.isMinting) return { admitted: false, reason: "No minting" };
        return { admitted: true };
      })
      .build();
    const result = await mintAgent({
      subjectDid: "did:key:z6MkTest1",
      policy: policy2,
    });
    expect(result.admission.admitted).toBe(false);
  });

  it("should set minting justification", async () => {
    const policy = createPolicy("t").allowMinting({ requireJustification: true }).build();
    const result = await mintAgent({
      subjectDid: "did:key:z6MkTest1",
      justification: "Migrating from legacy system",
      policy,
    });
    // justification is set on the result but not passed to policy context yet
    expect(result.admission.mintingJustification).toBe("Migrating from legacy system");
  });

  it("should sign arrival with platform identity", async () => {
    const kp = generateKeyPair();
    const policy = createPolicy("t").allowMinting().build();
    const result = await mintAgent({
      subjectDid: "did:key:z6MkTest1",
      platformIdentity: kp,
      policy,
    });
    expect(result.arrivalMarker.proof).toBeDefined();
  });

  it("should emit agent:minted event", async () => {
    const emitter = new AdmissionEventEmitter();
    const handler = vi.fn();
    emitter.on("agent:minted", handler);
    const policy = createPolicy("t").allowMinting().build();
    await mintAgent({
      subjectDid: "did:key:z6MkTest1",
      policy,
      emitter,
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("should set subject on arrival marker", async () => {
    const policy = createPolicy("t").allowMinting().build();
    const result = await mintAgent({
      subjectDid: "did:key:z6MkCustom",
      policy,
    });
    expect(result.arrivalMarker.subject).toBe("did:key:z6MkCustom");
  });
});

describe("bulkMint()", () => {
  it("should mint multiple agents", async () => {
    const policy = createPolicy("t").allowMinting().build();
    const result = await bulkMint(
      [
        { subjectDid: "did:key:z6Mk1" },
        { subjectDid: "did:key:z6Mk2" },
        { subjectDid: "did:key:z6Mk3" },
      ],
      { policy }
    );
    expect(result.succeeded).toBe(3);
    expect(result.failed).toBe(0);
    expect(result.results.length).toBe(3);
  });

  it("should set admissionType to migration", async () => {
    const policy = createPolicy("t").allowMinting().build();
    const result = await bulkMint(
      [{ subjectDid: "did:key:z6Mk1" }],
      { policy }
    );
    expect(result.results[0].admission.admissionType).toBe("migration");
  });

  it("should track failures", async () => {
    const policy = createPolicy("t")
      .custom("odd-only", (_m, ctx) => {
        // This is called for all minting operations the same way
        return { admitted: false, reason: "Denied" };
      })
      .build();
    const result = await bulkMint(
      [{ subjectDid: "did:key:z6Mk1" }, { subjectDid: "did:key:z6Mk2" }],
      { policy }
    );
    expect(result.failed).toBe(2);
    expect(result.succeeded).toBe(0);
  });

  it("should include justification per agent", async () => {
    const policy = createPolicy("t").allowMinting().build();
    const result = await bulkMint(
      [
        { subjectDid: "did:key:z6Mk1", justification: "Migration batch 1" },
        { subjectDid: "did:key:z6Mk2", justification: "Migration batch 2" },
      ],
      { policy }
    );
    expect(result.results[0].admission.mintingJustification).toBe("Migration batch 1");
    expect(result.results[1].admission.mintingJustification).toBe("Migration batch 2");
  });

  it("should work with empty array", async () => {
    const policy = createPolicy("t").allowMinting().build();
    const result = await bulkMint([], { policy });
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.results).toEqual([]);
  });

  it("should accept platform identity", async () => {
    const kp = generateKeyPair();
    const policy = createPolicy("t").allowMinting().build();
    const result = await bulkMint(
      [{ subjectDid: "did:key:z6Mk1" }],
      { policy, platformIdentity: kp }
    );
    expect(result.results[0].arrivalMarker.proof).toBeDefined();
  });
});
