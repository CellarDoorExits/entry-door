import { describe, it, expect } from "vitest";
import {
  quickExit,
  quickCounterSign,
  generateIdentity,
  createMarker,
  signMarker,
  addModule,
  ExitType,
  StatusConfirmation,
  type ExitMarker,
} from "cellar-door-exit";
import {
  createPolicy,
  PolicyBuilder,
  REQUIRE_MUTUAL,
  CAUTIOUS,
  QUARANTINE_UNKNOWN,
  OPEN_DOOR_V2,
  type BuiltPolicy,
} from "../policy-builder.js";
import { evaluateAdmission } from "../admission-policy.js";

async function makeExit(origin = "https://platform-a.example.com") {
  return (await quickExit(origin)).marker;
}

async function makeMutualExit(origin = "https://platform-a.example.com") {
  const { marker } = await quickExit(origin);
  return quickCounterSign(marker).marker;
}

function makeExitWithType(exitType: ExitType, origin = "https://platform-a.example.com") {
  const identity = generateIdentity();
  const opts: any = { subject: identity.did, origin, exitType };
  if (exitType === ExitType.Emergency) opts.emergencyJustification = "test emergency";
  const marker = createMarker(opts);
  return signMarker(marker, identity.privateKey, identity.publicKey);
}

describe("PolicyBuilder", () => {
  describe("basic builder", () => {
    it("should create a named policy", () => {
      const policy = createPolicy("test-policy").build();
      expect(policy.name).toBe("test-policy");
    });

    it("should default to deny-overrides", () => {
      const policy = createPolicy("test").build();
      expect(policy.conflictStrategy).toBe("deny-overrides");
    });

    it("should deny by default when no rules defined (fail-closed)", async () => {
      const policy = createPolicy("closed").build();
      const marker = await makeExit();
      const result = policy.evaluate(marker);
      expect(result.admitted).toBe(false);
    });

    it("should admit by default when defaultDecision is admit", async () => {
      const policy = createPolicy("open").defaultDecision("admit").build();
      const marker = await makeExit();
      const result = policy.evaluate(marker);
      expect(result.admitted).toBe(true);
    });
  });

  describe("requireConfirmation", () => {
    it("should deny self-only when mutual required", async () => {
      const policy = createPolicy("strict").requireConfirmation("mutual").build();
      const marker = await makeExit(); // self-only
      const result = policy.evaluate(marker);
      expect(result.admitted).toBe(false);
    });

    it("should admit mutual when mutual required", async () => {
      const policy = createPolicy("strict").requireConfirmation("mutual").build();
      const marker = await makeMutualExit();
      const result = policy.evaluate(marker);
      expect(result.admitted).toBe(true);
    });

    it("should accept string confirmation levels", async () => {
      const policy = createPolicy("t").requireConfirmation("self_only").build();
      const marker = await makeExit();
      const result = policy.evaluate(marker);
      expect(result.admitted).toBe(true);
    });

    it("should accept StatusConfirmation enum", async () => {
      const policy = createPolicy("t").requireConfirmation(StatusConfirmation.Mutual).build();
      const marker = await makeExit();
      const result = policy.evaluate(marker);
      expect(result.admitted).toBe(false);
    });

    it("should abstain for minting", () => {
      const policy = createPolicy("t").requireConfirmation("mutual").allowMinting().build();
      const result = policy.evaluate(null, { isMinting: true });
      expect(result.admitted).toBe(true);
    });
  });

  describe("requireVerifiedDeparture", () => {
    it("should deny unsigned markers", () => {
      const identity = generateIdentity();
      const marker = createMarker({ subject: identity.did, origin: "test", exitType: ExitType.Voluntary });
      const policy = createPolicy("t").requireVerifiedDeparture().build();
      const result = policy.evaluate(marker);
      expect(result.admitted).toBe(false);
    });

    it("should admit signed markers", async () => {
      const policy = createPolicy("t").requireVerifiedDeparture().build();
      const marker = await makeExit();
      const result = policy.evaluate(marker);
      expect(result.admitted).toBe(true);
    });
  });

  describe("maxAge", () => {
    it("should deny old markers", async () => {
      const policy = createPolicy("t").maxAge("1h").build();
      const marker = await makeExit();
      // Make marker old by evaluating with a future time
      const future = new Date(Date.now() + 2 * 3600 * 1000);
      const result = policy.evaluate(marker, { now: future });
      expect(result.admitted).toBe(false);
    });

    it("should admit recent markers", async () => {
      const policy = createPolicy("t").maxAge("24h").build();
      const marker = await makeExit();
      const result = policy.evaluate(marker);
      expect(result.admitted).toBe(true);
    });

    it("should accept numeric duration", async () => {
      const policy = createPolicy("t").maxAge(86400000).build();
      const marker = await makeExit();
      const result = policy.evaluate(marker);
      expect(result.admitted).toBe(true);
    });
  });

  describe("allowExitTypes", () => {
    it("should deny non-matching exit types", () => {
      const policy = createPolicy("t").allowExitTypes(["voluntary"]).build();
      const marker = makeExitWithType(ExitType.Emergency);
      const result = policy.evaluate(marker);
      expect(result.admitted).toBe(false);
    });

    it("should admit matching exit types", () => {
      const policy = createPolicy("t").allowExitTypes(["voluntary", "emergency"]).build();
      const marker = makeExitWithType(ExitType.Voluntary);
      const result = policy.evaluate(marker);
      expect(result.admitted).toBe(true);
    });
  });

  describe("blockOrigins", () => {
    it("should deny blocked origins", async () => {
      const policy = createPolicy("t").blockOrigins(["https://bad.example.com"], { reason: "Bad actor" }).build();
      const { marker } = await quickExit("https://bad.example.com");
      const result = policy.evaluate(marker);
      expect(result.admitted).toBe(false);
      expect(result.reasons[0]).toContain("Bad actor");
    });

    it("should admit non-blocked origins", async () => {
      const policy = createPolicy("t").blockOrigins(["https://bad.example.com"], { reason: "Bad" }).build();
      const marker = await makeExit("https://good.example.com");
      const result = policy.evaluate(marker);
      expect(result.admitted).toBe(true);
    });
  });

  describe("allowOrigins", () => {
    it("should deny non-allowed origins", async () => {
      const policy = createPolicy("t").allowOrigins(["https://trusted.example.com"]).build();
      const marker = await makeExit("https://unknown.example.com");
      const result = policy.evaluate(marker);
      expect(result.admitted).toBe(false);
    });

    it("should admit allowed origins", async () => {
      const policy = createPolicy("t").allowOrigins(["https://trusted.example.com"]).build();
      const { marker } = await quickExit("https://trusted.example.com");
      const result = policy.evaluate(marker);
      expect(result.admitted).toBe(true);
    });
  });

  describe("requireModules", () => {
    it("should deny markers missing required modules", async () => {
      const policy = createPolicy("t").requireModules(["lineage"]).build();
      const marker = await makeExit();
      const result = policy.evaluate(marker);
      expect(result.admitted).toBe(false);
    });

    it("should admit markers with required modules", async () => {
      const policy = createPolicy("t").requireModules(["lineage"]).build();
      let marker = await makeExit();
      (marker as any).lineage = { predecessors: [] };
      const result = policy.evaluate(marker);
      expect(result.admitted).toBe(true);
    });
  });

  describe("onDisputed", () => {
    it("should quarantine disputed markers", async () => {
      const policy = createPolicy("t").onDisputed("quarantine", { maxDuration: "7d" }).build();
      let marker = await makeExit();
      (marker as any).dispute = { ...marker.dispute, disputes: [{ id: "d1", challenger: "x", claim: "test" }] };
      const result = policy.evaluate(marker);
      expect(result.admitted).toBe(true);
      expect(result.conditions).toContain("quarantine");
    });

    it("should reject disputed markers when configured", async () => {
      const policy = createPolicy("t").onDisputed("reject").build();
      let marker = await makeExit();
      (marker as any).dispute = { disputes: [{ id: "d1", challenger: "x", claim: "test" }] };
      const result = policy.evaluate(marker);
      expect(result.admitted).toBe(false);
    });

    it("should abstain for non-disputed markers (default deny)", async () => {
      const policy = createPolicy("t").onDisputed("reject").build();
      const marker = await makeExit();
      const result = policy.evaluate(marker);
      expect(result.admitted).toBe(false); // Abstain defaults to deny (fail-closed)
    });
  });

  describe("onSelfOnly", () => {
    it("should add probation for self-only markers", async () => {
      const policy = createPolicy("t").onSelfOnly("probation", { duration: "7d" }).build();
      const marker = await makeExit(); // self_only
      const result = policy.evaluate(marker);
      expect(result.admitted).toBe(true);
      expect(result.conditions).toContain("probation");
    });

    it("should reject self-only when configured", async () => {
      const policy = createPolicy("t").onSelfOnly("reject").build();
      const marker = await makeExit();
      const result = policy.evaluate(marker);
      expect(result.admitted).toBe(false);
    });

    it("should not trigger for mutual markers (abstain → default deny)", async () => {
      const policy = createPolicy("t").onSelfOnly("reject").build();
      const marker = await makeMutualExit();
      const result = policy.evaluate(marker);
      expect(result.admitted).toBe(false); // Abstain → default deny
    });
  });

  describe("allowMinting", () => {
    it("should allow minting when configured", () => {
      const policy = createPolicy("t").allowMinting().build();
      const result = policy.evaluate(null, { isMinting: true });
      expect(result.admitted).toBe(true);
    });

    it("should deny minting when not configured (default deny)", () => {
      const policy = createPolicy("t").build();
      const result = policy.evaluate(null, { isMinting: true });
      // No minting rule means abstain → default deny (fail-closed)
      expect(result.admitted).toBe(false);
    });

    it("should require justification when configured", () => {
      const policy = createPolicy("t").allowMinting({ requireJustification: true }).build();
      const result = policy.evaluate(null, { isMinting: true });
      expect(result.admitted).toBe(false);
      expect(result.reasons[0]).toContain("justification");
    });

    it("should accept justification", () => {
      const policy = createPolicy("t").allowMinting({ requireJustification: true }).build();
      const result = policy.evaluate(null, { isMinting: true, mintingJustification: "Migration" });
      expect(result.admitted).toBe(true);
    });

    it("should add enhanced probation conditions", () => {
      const policy = createPolicy("t").allowMinting({ enhancedProbation: "14d" }).build();
      const result = policy.evaluate(null, { isMinting: true });
      expect(result.conditions).toContain("probation");
      expect(result.conditions).toContain("probation-duration:14d");
    });
  });

  describe("custom rules", () => {
    it("should evaluate custom rules", async () => {
      const policy = createPolicy("t")
        .custom("my-rule", (marker) => ({ admitted: !!marker, reason: "need a marker" }))
        .build();
      const marker = await makeExit();
      expect(policy.evaluate(marker).admitted).toBe(true);
      expect(policy.evaluate(null).admitted).toBe(false);
    });
  });

  describe("conflictResolution", () => {
    it("should use deny-overrides by default", async () => {
      const policy = createPolicy("t")
        .requireVerifiedDeparture() // admits (signed marker)
        .requireConfirmation("mutual") // denies (self-only)
        .build();
      const marker = await makeExit();
      const result = policy.evaluate(marker);
      expect(result.admitted).toBe(false); // deny wins
    });

    it("should support permit-overrides", async () => {
      const policy = createPolicy("t")
        .requireVerifiedDeparture()
        .requireConfirmation("mutual")
        .conflictResolution("permit-overrides")
        .build();
      const marker = await makeExit();
      const result = policy.evaluate(marker);
      expect(result.admitted).toBe(true); // permit wins
    });

    it("should support first-match", async () => {
      const policy = createPolicy("t")
        .requireVerifiedDeparture() // first decisive: admit
        .requireConfirmation("mutual") // would deny, but first match wins
        .conflictResolution("first-match")
        .build();
      const marker = await makeExit();
      const result = policy.evaluate(marker);
      expect(result.admitted).toBe(true);
    });
  });

  describe("composition", () => {
    it("should compose multiple rules", async () => {
      const policy = createPolicy("complex")
        .requireVerifiedDeparture()
        .allowExitTypes(["voluntary"])
        .maxAge("24h")
        .build();
      const marker = await makeExit();
      const result = policy.evaluate(marker);
      expect(result.admitted).toBe(true);
    });

    it("should deny when any rule fails (deny-overrides)", async () => {
      const policy = createPolicy("complex")
        .requireVerifiedDeparture()
        .allowExitTypes(["emergency"]) // will deny voluntary
        .build();
      const marker = await makeExit(); // voluntary
      const result = policy.evaluate(marker);
      expect(result.admitted).toBe(false);
    });
  });

  describe("serialization", () => {
    it("should serialize to JSON", () => {
      const policy = createPolicy("test")
        .requireVerifiedDeparture()
        .maxAge("24h")
        .build();
      const json = policy.toJSON();
      expect(json.name).toBe("test");
      expect(json.rules.length).toBe(2);
      expect(json.customRulesOmitted).toEqual([]);
    });

    it("should round-trip via fromJSON", async () => {
      const original = createPolicy("roundtrip")
        .requireVerifiedDeparture()
        .maxAge("24h")
        .allowExitTypes(["voluntary"])
        .build();
      const json = original.toJSON();
      const restored = PolicyBuilder.fromJSON(json).build();
      const marker = await makeExit();
      const r1 = original.evaluate(marker);
      const r2 = restored.evaluate(marker);
      expect(r1.admitted).toBe(r2.admitted);
    });

    it("should note custom rules as omitted", async () => {
      const policy = createPolicy("with-custom")
        .custom("my-rule", () => ({ admitted: true }))
        .build();
      const json = policy.toJSON();
      expect(json.customRulesOmitted).toEqual(["my-rule"]);
    });

    it("should serialize complex policies", () => {
      const policy = createPolicy("complex")
        .requireConfirmation("mutual")
        .requireVerifiedDeparture()
        .maxAge("24h")
        .allowExitTypes(["voluntary"])
        .blockOrigins(["bad.com"], { reason: "Bad" })
        .onDisputed("quarantine", { maxDuration: "7d" })
        .onSelfOnly("probation", { duration: "7d" })
        .allowMinting({ requireJustification: true })
        .conflictResolution("first-match")
        .build();
      const json = policy.toJSON();
      expect(json.conflictStrategy).toBe("first-match");
      expect(json.rules.length).toBe(8);
    });

    it("should restore from complex JSON", () => {
      const original = createPolicy("complex")
        .requireConfirmation("mutual")
        .requireVerifiedDeparture()
        .allowMinting({ requireJustification: true, enhancedProbation: "14d" })
        .build();
      const json = original.toJSON();
      const restored = PolicyBuilder.fromJSON(json).build();
      expect(restored.name).toBe("complex");
      // Minting with justification should work
      const r = restored.evaluate(null, { isMinting: true, mintingJustification: "test" });
      expect(r.admitted).toBe(true);
    });
  });

  describe("dryRun", () => {
    it("should return an evaluation trace", async () => {
      const policy = createPolicy("trace-test")
        .requireVerifiedDeparture()
        .maxAge("24h")
        .build();
      const marker = await makeExit();
      const trace = policy.dryRun(marker);
      expect(trace.policyName).toBe("trace-test");
      expect(trace.rules.length).toBe(2);
      expect(trace.decision.admitted).toBe(true);
      expect(trace.timestamp).toBeDefined();
    });

    it("should show individual rule results", async () => {
      const policy = createPolicy("t")
        .requireVerifiedDeparture()
        .requireConfirmation("mutual")
        .build();
      const marker = await makeExit(); // self-only
      const trace = policy.dryRun(marker);
      expect(trace.rules[0].decision).toBe("admit"); // verified departure
      expect(trace.rules[1].decision).toBe("deny");  // confirmation level
      expect(trace.decision.admitted).toBe(false);
    });
  });

  describe("backward compat with evaluateAdmission", () => {
    it("should accept BuiltPolicy in evaluateAdmission", async () => {
      const policy = createPolicy("t").requireVerifiedDeparture().build();
      const marker = await makeExit();
      const result = evaluateAdmission(marker, policy as any);
      expect(result.admitted).toBe(true);
    });

    it("should still accept flat AdmissionPolicy", async () => {
      const marker = await makeExit();
      const result = evaluateAdmission(marker, { requireVerifiedDeparture: true });
      expect(result.admitted).toBe(true);
    });
  });

  describe("presets", () => {
    it("REQUIRE_MUTUAL should deny self-only", async () => {
      const marker = await makeExit();
      const result = REQUIRE_MUTUAL.evaluate(marker);
      expect(result.admitted).toBe(false);
    });

    it("REQUIRE_MUTUAL should admit mutual", async () => {
      const marker = await makeMutualExit();
      const result = REQUIRE_MUTUAL.evaluate(marker);
      expect(result.admitted).toBe(true);
    });

    it("CAUTIOUS should probation self-only", async () => {
      const marker = await makeExit();
      const result = CAUTIOUS.evaluate(marker);
      expect(result.admitted).toBe(true);
      expect(result.conditions).toContain("probation");
    });

    it("CAUTIOUS should quarantine disputed", async () => {
      let marker = await makeExit();
      (marker as any).dispute = { disputes: [{ id: "d1", challenger: "x", claim: "test" }] };
      const result = CAUTIOUS.evaluate(marker);
      expect(result.conditions).toContain("quarantine");
    });

    it("CAUTIOUS should require minting justification", () => {
      const result = CAUTIOUS.evaluate(null, { isMinting: true });
      expect(result.admitted).toBe(false);
    });

    it("CAUTIOUS should allow minting with justification", () => {
      const result = CAUTIOUS.evaluate(null, { isMinting: true, mintingJustification: "Migration" });
      expect(result.admitted).toBe(true);
    });

    it("QUARANTINE_UNKNOWN should quarantine disputed", async () => {
      let marker = await makeExit();
      (marker as any).dispute = { disputes: [{ id: "d1", challenger: "x", claim: "test" }] };
      const result = QUARANTINE_UNKNOWN.evaluate(marker);
      expect(result.conditions).toContain("quarantine");
    });

    it("QUARANTINE_UNKNOWN should admit clean markers", async () => {
      const marker = await makeExit();
      const result = QUARANTINE_UNKNOWN.evaluate(marker);
      expect(result.admitted).toBe(true);
    });

    it("OPEN_DOOR_V2 should admit by default", async () => {
      const marker = await makeExit();
      const result = OPEN_DOOR_V2.evaluate(marker);
      expect(result.admitted).toBe(true);
    });
  });

  describe("blocklist expiration", () => {
    it("should block unexpired origins", async () => {
      const future = new Date(Date.now() + 86400000).toISOString();
      const policy = createPolicy("t")
        .custom("origin-block", (marker, ctx) => {
          // Use origin rule directly
          return { name: "origin-block", decision: "deny", reason: "blocked" };
        })
        .build();
      // Test via createOriginRule directly
      const { createOriginRule } = await import("../rules/origin-rule.js");
      const rule = createOriginRule({
        blockedOrigins: [{ origin: "https://bad.example.com", reason: "spam", expiresAt: future }],
      });
      const marker = await makeExit("https://bad.example.com");
      const result = rule.evaluate(marker, { isMinting: false, now: new Date() });
      expect(result.decision).toBe("deny");
    });

    it("should allow expired blocked origins", async () => {
      const past = new Date(Date.now() - 86400000).toISOString();
      const { createOriginRule } = await import("../rules/origin-rule.js");
      const rule = createOriginRule({
        blockedOrigins: [{ origin: "https://bad.example.com", reason: "spam", expiresAt: past }],
      });
      const marker = await makeExit("https://bad.example.com");
      const result = rule.evaluate(marker, { isMinting: false, now: new Date() });
      expect(result.decision).toBe("admit");
    });

    it("should support structured block reasons", async () => {
      const { createOriginRule } = await import("../rules/origin-rule.js");
      const rule = createOriginRule({
        blockedOrigins: [{ origin: "https://bad.example.com", reason: { category: "security", detail: "Known malicious" } }],
      });
      const marker = await makeExit("https://bad.example.com");
      const result = rule.evaluate(marker, { isMinting: false, now: new Date() });
      expect(result.decision).toBe("deny");
      expect(result.reason).toContain("[security]");
      expect(result.reason).toContain("Known malicious");
    });
  });

  describe("condition parsing", () => {
    it("should format and parse simple conditions", async () => {
      const { formatCondition, parseCondition } = await import("../rules/condition.js");
      expect(formatCondition({ type: "quarantine" })).toBe("quarantine");
      expect(parseCondition("quarantine")).toEqual({ type: "quarantine" });
    });

    it("should format and parse parameterized conditions", async () => {
      const { formatCondition, parseCondition } = await import("../rules/condition.js");
      const formatted = formatCondition({ type: "quarantine", params: { max: "7d" } });
      expect(formatted).toBe("quarantine-max:7d");
      const parsed = parseCondition("quarantine-max:7d");
      expect(parsed.type).toBe("quarantine");
      expect(parsed.params).toEqual({ max: "7d" });
    });

    it("should round-trip probation conditions", async () => {
      const { formatCondition, parseCondition } = await import("../rules/condition.js");
      const c = { type: "probation" as const, params: { duration: "14d" } };
      const parsed = parseCondition(formatCondition(c));
      expect(parsed.type).toBe("probation");
      expect(parsed.params!.duration).toBe("14d");
    });
  });

  describe("REQUIRE_MUTUAL_WITH_ONRAMP preset", () => {
    it("should reject without mutual confirmation", async () => {
      const { REQUIRE_MUTUAL_WITH_ONRAMP } = await import("../policy-builder.js");
      const marker = await makeExit();
      const result = REQUIRE_MUTUAL_WITH_ONRAMP.evaluate(marker);
      expect(result.admitted).toBe(false);
    });

    it("should admit minting with justification", async () => {
      const { REQUIRE_MUTUAL_WITH_ONRAMP } = await import("../policy-builder.js");
      const result = REQUIRE_MUTUAL_WITH_ONRAMP.evaluate(null, {
        isMinting: true,
        mintingJustification: "new user onboarding",
      });
      expect(result.admitted).toBe(true);
    });

    it("should reject minting without justification", async () => {
      const { REQUIRE_MUTUAL_WITH_ONRAMP } = await import("../policy-builder.js");
      const result = REQUIRE_MUTUAL_WITH_ONRAMP.evaluate(null, { isMinting: true });
      expect(result.admitted).toBe(false);
    });
  });

  describe("fromJSON unknown rule warnings", () => {
    it("should collect warnings for unknown rule types", () => {
      const json = {
        name: "test",
        conflictStrategy: "deny-overrides" as const,
        rules: [
          { type: "verified-departure" },
          { type: "unknown-future-rule", foo: "bar" },
          { type: "another-unknown" },
        ],
        customRulesOmitted: [],
      };
      const builder = PolicyBuilder.fromJSON(json);
      const policy = builder.build();
      expect(policy._warnings).toBeDefined();
      expect(policy._warnings!.length).toBe(2);
      expect(policy._warnings![0]).toContain("unknown-future-rule");
    });
  });
});
