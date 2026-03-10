import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqliteClaimStore } from "../sqlite-store.js";
import type { AdmissionRecord } from "../admit.js";
import { StatusConfirmation } from "cellar-door-exit";

function makeRecord(overrides: Partial<AdmissionRecord> = {}): AdmissionRecord {
  return {
    id: `rec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    exitMarkerId: "exit-123",
    arrivalMarkerId: "arrival-456",
    subjectDid: "did:key:z6MkSubject",
    originDid: "https://origin.example.com",
    confirmationLevel: StatusConfirmation.SelfOnly,
    policyApplied: "cautious",
    policyVersion: "abc123",
    admitted: true,
    admissionType: "standard",
    counterSigned: false,
    reasonCodes: ["[verified-departure] Departure is signed"],
    conditions: [],
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe("SqliteClaimStore", () => {
  let store: SqliteClaimStore;

  beforeEach(async () => {
    store = new SqliteClaimStore(":memory:");
    await store.init();
  });

  afterEach(() => {
    store.close();
  });

  describe("claims", () => {
    it("should claim an exit marker", async () => {
      const success = await store.claim("exit-1", "arrival-1");
      expect(success).toBe(true);
    });

    it("should reject duplicate claims", async () => {
      await store.claim("exit-1", "arrival-1");
      const success = await store.claim("exit-1", "arrival-2");
      expect(success).toBe(false);
    });

    it("should check if claimed", async () => {
      expect(await store.isClaimed("exit-1")).toBe(false);
      await store.claim("exit-1", "arrival-1");
      expect(await store.isClaimed("exit-1")).toBe(true);
    });

    it("should get arrival ID", async () => {
      await store.claim("exit-1", "arrival-1");
      expect(await store.getArrivalId("exit-1")).toBe("arrival-1");
    });

    it("should return undefined for unknown claims", async () => {
      expect(await store.getArrivalId("nonexistent")).toBeUndefined();
    });

    it("should revoke by arrival ID", async () => {
      await store.claim("exit-1", "arrival-1");
      const success = await store.revoke("arrival-1");
      expect(success).toBe(true);
      expect(await store.isClaimed("exit-1")).toBe(false);
    });

    it("should return false revoking unknown arrival", async () => {
      expect(await store.revoke("nonexistent")).toBe(false);
    });

    it("should delete claims by subject", async () => {
      await store.claim("exit-1", "arrival-1", "did:key:z6MkSub");
      await store.claim("exit-2", "arrival-2", "did:key:z6MkSub");
      await store.claim("exit-3", "arrival-3", "did:key:z6MkOther");
      const deleted = await store.deleteBySubject("did:key:z6MkSub");
      expect(deleted).toBe(2);
      expect(await store.isClaimed("exit-1")).toBe(false);
      expect(await store.isClaimed("exit-3")).toBe(true);
    });
  });

  describe("admission records", () => {
    it("should put and get an admission record", async () => {
      const record = makeRecord({ id: "test-1" });
      await store.putAdmission(record);
      const retrieved = await store.getAdmission("test-1");
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe("test-1");
      expect(retrieved!.subjectDid).toBe("did:key:z6MkSubject");
      expect(retrieved!.admitted).toBe(true);
    });

    it("should return undefined for unknown records", async () => {
      const result = await store.getAdmission("nonexistent");
      expect(result).toBeUndefined();
    });

    it("should store and retrieve reason codes", async () => {
      const record = makeRecord({ reasonCodes: ["reason-1", "reason-2"] });
      await store.putAdmission(record);
      const retrieved = await store.getAdmission(record.id);
      expect(retrieved!.reasonCodes).toEqual(["reason-1", "reason-2"]);
    });

    it("should store and retrieve conditions", async () => {
      const record = makeRecord({ conditions: ["probation", "review-required"] });
      await store.putAdmission(record);
      const retrieved = await store.getAdmission(record.id);
      expect(retrieved!.conditions).toEqual(["probation", "review-required"]);
    });

    it("should store quarantine info", async () => {
      const expires = new Date(Date.now() + 7 * 86400000).toISOString();
      const record = makeRecord({
        quarantined: true,
        quarantineExpires: expires,
      });
      await store.putAdmission(record);
      const retrieved = await store.getAdmission(record.id);
      expect(retrieved!.quarantined).toBe(true);
      expect(retrieved!.quarantineExpires).toBe(expires);
    });

    it("should store counter-sign info", async () => {
      const record = makeRecord({
        counterSigned: true,
        counterSignMeaning: "terms_acknowledged",
      });
      await store.putAdmission(record);
      const retrieved = await store.getAdmission(record.id);
      expect(retrieved!.counterSigned).toBe(true);
      expect(retrieved!.counterSignMeaning).toBe("terms_acknowledged");
    });

    it("should store minting records", async () => {
      const record = makeRecord({
        admissionType: "minted",
        mintingJustification: "Migration from legacy",
        exitMarkerId: undefined,
        originDid: undefined,
      });
      await store.putAdmission(record);
      const retrieved = await store.getAdmission(record.id);
      expect(retrieved!.admissionType).toBe("minted");
      expect(retrieved!.mintingJustification).toBe("Migration from legacy");
    });

    it("should reject duplicate ID (immutable records)", async () => {
      const record = makeRecord({ id: "dup-1", admitted: true });
      await store.putAdmission(record);
      const updated = { ...record, admitted: false };
      await expect(store.putAdmission(updated)).rejects.toThrow(/UNIQUE constraint/);
      // Original record unchanged
      const retrieved = await store.getAdmission("dup-1");
      expect(retrieved!.admitted).toBe(true);
    });
  });

  describe("query methods", () => {
    it("should get admission history by subject", async () => {
      await store.putAdmission(makeRecord({ id: "r1", subjectDid: "did:key:z6MkA", timestamp: "2024-01-01T00:00:00Z" }));
      await store.putAdmission(makeRecord({ id: "r2", subjectDid: "did:key:z6MkA", timestamp: "2024-01-02T00:00:00Z" }));
      await store.putAdmission(makeRecord({ id: "r3", subjectDid: "did:key:z6MkB", timestamp: "2024-01-01T00:00:00Z" }));
      const history = await store.getAdmissionHistory("did:key:z6MkA");
      expect(history.length).toBe(2);
      // Ordered by timestamp DESC
      expect(history[0].id).toBe("r2");
    });

    it("should get admissions by policy", async () => {
      await store.putAdmission(makeRecord({ id: "r1", policyApplied: "cautious" }));
      await store.putAdmission(makeRecord({ id: "r2", policyApplied: "strict" }));
      await store.putAdmission(makeRecord({ id: "r3", policyApplied: "cautious" }));
      const results = await store.getAdmissionsByPolicy("cautious");
      expect(results.length).toBe(2);
    });

    it("should support limit and offset on policy query", async () => {
      for (let i = 0; i < 5; i++) {
        await store.putAdmission(makeRecord({ id: `r${i}`, policyApplied: "cautious", timestamp: `2024-01-0${i + 1}T00:00:00Z` }));
      }
      const page1 = await store.getAdmissionsByPolicy("cautious", { limit: 2 });
      expect(page1.length).toBe(2);
      const page2 = await store.getAdmissionsByPolicy("cautious", { limit: 2, offset: 2 });
      expect(page2.length).toBe(2);
    });

    it("should get quarantined records", async () => {
      await store.putAdmission(makeRecord({ id: "q1", quarantined: true, quarantineExpires: "2099-01-01T00:00:00Z" }));
      await store.putAdmission(makeRecord({ id: "q2", quarantined: true, quarantineResolution: "admitted" }));
      await store.putAdmission(makeRecord({ id: "r1" }));
      const quarantined = await store.getQuarantined();
      expect(quarantined.length).toBe(1);
      expect(quarantined[0].id).toBe("q1");
    });

    it("should get expired quarantines", async () => {
      const past = new Date(Date.now() - 86400000).toISOString();
      const future = new Date(Date.now() + 86400000).toISOString();
      await store.putAdmission(makeRecord({ id: "exp1", quarantined: true, quarantineExpires: past }));
      await store.putAdmission(makeRecord({ id: "exp2", quarantined: true, quarantineExpires: future }));
      const expired = await store.getExpiredQuarantines();
      expect(expired.length).toBe(1);
      expect(expired[0].id).toBe("exp1");
    });
  });

  describe("contestAdmission", () => {
    it("should contest an admission", async () => {
      await store.putAdmission(makeRecord({ id: "c1", quarantined: true }));
      const success = await store.contestAdmission("c1", "Unfair treatment");
      expect(success).toBe(true);
      const record = await store.getAdmission("c1");
      expect(record!.quarantineResolution).toBe("contested");
    });

    it("should return false for unknown record", async () => {
      const success = await store.contestAdmission("nonexistent", "reason");
      expect(success).toBe(false);
    });
  });

  describe("GDPR erasure", () => {
    it("should delete all admissions by subject", async () => {
      await store.putAdmission(makeRecord({ id: "g1", subjectDid: "did:key:z6MkErase" }));
      await store.putAdmission(makeRecord({ id: "g2", subjectDid: "did:key:z6MkErase" }));
      await store.putAdmission(makeRecord({ id: "g3", subjectDid: "did:key:z6MkKeep" }));
      const deleted = await store.deleteAdmissionsBySubject("did:key:z6MkErase");
      expect(deleted).toBe(2);
      const remaining = await store.getAdmissionHistory("did:key:z6MkErase");
      expect(remaining.length).toBe(0);
      const kept = await store.getAdmissionHistory("did:key:z6MkKeep");
      expect(kept.length).toBe(1);
    });

    it("should delete both claims and admissions", async () => {
      await store.claim("exit-1", "arrival-1", "did:key:z6MkErase");
      await store.putAdmission(makeRecord({ id: "g1", subjectDid: "did:key:z6MkErase" }));
      await store.deleteBySubject("did:key:z6MkErase");
      await store.deleteAdmissionsBySubject("did:key:z6MkErase");
      expect(await store.isClaimed("exit-1")).toBe(false);
      expect((await store.getAdmissionHistory("did:key:z6MkErase")).length).toBe(0);
    });
  });

  describe("stats", () => {
    it("should return correct stats", async () => {
      await store.claim("e1", "a1");
      await store.claim("e2", "a2");
      await store.putAdmission(makeRecord({ id: "s1", admitted: true, policyApplied: "cautious", confirmationLevel: StatusConfirmation.SelfOnly }));
      await store.putAdmission(makeRecord({ id: "s2", admitted: false, policyApplied: "strict", confirmationLevel: StatusConfirmation.Mutual }));
      await store.putAdmission(makeRecord({ id: "s3", admitted: true, policyApplied: "cautious", quarantined: true }));
      await store.putAdmission(makeRecord({ id: "s4", admitted: true, admissionType: "minted", policyApplied: "open" }));

      const stats = await store.stats();
      expect(stats.totalClaims).toBe(2);
      expect(stats.totalAdmissions).toBe(4);
      expect(stats.admitted).toBe(3);
      expect(stats.rejected).toBe(1);
      expect(stats.quarantined).toBe(1);
      expect(stats.minted).toBe(1);
      expect(stats.byPolicy["cautious"]).toBe(2);
      expect(stats.byPolicy["strict"]).toBe(1);
      expect(stats.byConfirmation[StatusConfirmation.SelfOnly]).toBe(3);
    });

    it("should return zeros for empty store", async () => {
      const stats = await store.stats();
      expect(stats.totalClaims).toBe(0);
      expect(stats.totalAdmissions).toBe(0);
    });
  });

  describe("retention", () => {
    it("should set retention expires from opts", async () => {
      store.close();
      store = new SqliteClaimStore(":memory:", { retentionPeriod: 86400000 }); // 1 day
      await store.init();
      const record = makeRecord({ timestamp: "2024-06-01T00:00:00.000Z" });
      await store.putAdmission(record);
      const retrieved = await store.getAdmission(record.id);
      expect(retrieved!.retentionExpires).toBeDefined();
      // Should be ~1 day after the record timestamp
      const expires = new Date(retrieved!.retentionExpires!).getTime();
      const ts = new Date("2024-06-01T00:00:00.000Z").getTime();
      expect(expires - ts).toBe(86400000);
    });
  });

  describe("claim with subject", () => {
    it("should store subject with claim", async () => {
      await store.claim("exit-1", "arrival-1", "did:key:z6MkTest");
      const deleted = await store.deleteBySubject("did:key:z6MkTest");
      expect(deleted).toBe(1);
    });
  });

  describe("purgeExpiredRecords", () => {
    it("should delete records with expired retention", async () => {
      const past = new Date(Date.now() - 100000).toISOString();
      await store.putAdmission(makeRecord({ id: "purge-1", retentionExpires: past }));
      await store.putAdmission(makeRecord({ id: "purge-2", retentionExpires: undefined }));
      const purged = await store.purgeExpiredRecords();
      expect(purged).toBeGreaterThanOrEqual(1);
      expect(await store.getAdmission("purge-1")).toBeUndefined();
      expect(await store.getAdmission("purge-2")).toBeDefined();
    });
  });

  describe("eraseSubject", () => {
    it("should atomically delete claims and admissions for a subject", async () => {
      const did = "did:key:z6MkErase";
      await store.claim("exit-erase-1", "arrival-erase-1", did);
      await store.putAdmission(makeRecord({ id: "erase-adm-1", subjectDid: did }));
      await store.putAdmission(makeRecord({ id: "erase-adm-2", subjectDid: did }));
      const result = await store.eraseSubject(did);
      expect(result.claims).toBe(1);
      expect(result.admissions).toBe(2);
    });
  });

  describe("contestAdmission on rejections", () => {
    it("should contest rejected (non-quarantined) records", async () => {
      const record = makeRecord({ id: "contest-rej-1", admitted: false, quarantined: undefined });
      await store.putAdmission(record);
      const ok = await store.contestAdmission("contest-rej-1", "wrongful rejection");
      expect(ok).toBe(true);
      const retrieved = await store.getAdmission("contest-rej-1");
      expect(retrieved!.contested).toBe(true);
      expect(retrieved!.contestReason).toBe("wrongful rejection");
      // Should NOT set quarantine_resolution for non-quarantined records
      expect(retrieved!.quarantineResolution).toBeUndefined();
    });

    it("should contest quarantined records and set resolution", async () => {
      const record = makeRecord({ id: "contest-q-1", quarantined: true });
      await store.putAdmission(record);
      const ok = await store.contestAdmission("contest-q-1", "unfair quarantine");
      expect(ok).toBe(true);
      const retrieved = await store.getAdmission("contest-q-1");
      expect(retrieved!.contested).toBe(true);
      expect(retrieved!.quarantineResolution).toBe("contested");
    });
  });

  describe("resolveExpiredQuarantines", () => {
    it("should resolve expired quarantines", async () => {
      const past = new Date(Date.now() - 100000).toISOString();
      await store.putAdmission(makeRecord({
        id: "q-expired-1",
        quarantined: true,
        quarantineExpires: past,
      }));
      const resolved = await store.resolveExpiredQuarantines("reject");
      expect(resolved).toBe(1);
      const retrieved = await store.getAdmission("q-expired-1");
      expect(retrieved!.quarantineResolution).toBe("rejected");
    });
  });
});
