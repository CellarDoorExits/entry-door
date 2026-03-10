/**
 * cellar-door-entry — SQLite Claim Store
 *
 * Persistent claim and admission record storage using better-sqlite3.
 * Requires optional peer dependency: better-sqlite3.
 */

import type { ClaimStore } from "./claim-tracking.js";
import type { AdmissionRecord } from "./admit.js";

type Database = any;

export interface SqliteClaimStoreOpts {
  /** Retention period in ms. If set, records older than this are eligible for purge. */
  retentionPeriod?: number;
}

/**
 * SQLite-backed claim store with admission record storage.
 */
export class SqliteClaimStore implements ClaimStore {
  private db!: Database;
  private dbPath: string;
  private opts: SqliteClaimStoreOpts;
  private initialized = false;

  constructor(dbPath: string, opts?: SqliteClaimStoreOpts) {
    this.dbPath = dbPath;
    this.opts = opts ?? {};
  }

  private assertInit(): void {
    if (!this.initialized) {
      throw new Error("SqliteClaimStore.init() must be called before use");
    }
  }

  /**
   * Initialize the database: create tables, indexes, set pragmas.
   */
  async init(): Promise<void> {
    let BetterSqlite3: any;
    try {
      BetterSqlite3 = (await import("better-sqlite3")).default;
    } catch {
      throw new Error(
        "better-sqlite3 is required for SqliteClaimStore. Install it: npm i better-sqlite3"
      );
    }

    this.db = new BetterSqlite3(this.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.pragma("foreign_keys = ON");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS claims (
        exit_marker_id TEXT PRIMARY KEY,
        arrival_marker_id TEXT NOT NULL,
        subject_did TEXT,
        origin_did TEXT,
        timestamp TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS admissions (
        id TEXT PRIMARY KEY,
        exit_marker_id TEXT,
        arrival_marker_id TEXT NOT NULL,
        subject_did TEXT NOT NULL,
        origin_did TEXT,
        confirmation_level TEXT,
        policy_name TEXT NOT NULL,
        policy_version TEXT,
        admitted INTEGER NOT NULL DEFAULT 1,
        admission_type TEXT NOT NULL DEFAULT 'standard',
        counter_signed INTEGER NOT NULL DEFAULT 0,
        counter_sign_meaning TEXT,
        reason_codes TEXT,
        conditions TEXT,
        timestamp TEXT NOT NULL,
        quarantined INTEGER DEFAULT 0,
        quarantine_expires TEXT,
        quarantine_resolution TEXT,
        minting_justification TEXT,
        retention_expires TEXT,
        contested INTEGER DEFAULT 0,
        contest_reason TEXT,
        policy_snapshot TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_claims_subject ON claims(subject_did);
      CREATE INDEX IF NOT EXISTS idx_claims_arrival ON claims(arrival_marker_id);
      CREATE INDEX IF NOT EXISTS idx_admissions_subject ON admissions(subject_did);
      CREATE INDEX IF NOT EXISTS idx_admissions_origin ON admissions(origin_did);
      CREATE INDEX IF NOT EXISTS idx_admissions_policy_time ON admissions(policy_name, timestamp);
      CREATE INDEX IF NOT EXISTS idx_admissions_quarantine ON admissions(quarantined, quarantine_expires);
      CREATE INDEX IF NOT EXISTS idx_admissions_confirmation ON admissions(confirmation_level);
    `);
    this.initialized = true;
  }

  // ─── ClaimStore Interface ──────────────────────────────────────────────────

  async claim(exitMarkerId: string, arrivalMarkerId: string, subjectDid?: string): Promise<boolean> {
    this.assertInit();
    try {
      this.db.prepare(
        "INSERT INTO claims (exit_marker_id, arrival_marker_id, subject_did) VALUES (?, ?, ?)"
      ).run(exitMarkerId, arrivalMarkerId, subjectDid ?? null);
      return true;
    } catch (e: any) {
      if (e.code === "SQLITE_CONSTRAINT_PRIMARYKEY" || e.message?.includes("UNIQUE")) return false;
      throw e;
    }
  }

  async isClaimed(exitMarkerId: string): Promise<boolean> {
    this.assertInit();
    const row = this.db.prepare("SELECT 1 FROM claims WHERE exit_marker_id = ?").get(exitMarkerId);
    return !!row;
  }

  async getArrivalId(exitMarkerId: string): Promise<string | undefined> {
    this.assertInit();
    const row = this.db.prepare("SELECT arrival_marker_id FROM claims WHERE exit_marker_id = ?").get(exitMarkerId);
    return row?.arrival_marker_id;
  }

  async revoke(arrivalMarkerId: string): Promise<boolean> {
    this.assertInit();
    const result = this.db.prepare("DELETE FROM claims WHERE arrival_marker_id = ?").run(arrivalMarkerId);
    return result.changes > 0;
  }

  async deleteBySubject(subjectDid: string): Promise<number> {
    this.assertInit();
    const result = this.db.prepare("DELETE FROM claims WHERE subject_did = ?").run(subjectDid);
    return result.changes;
  }

  // ─── Admission Records ────────────────────────────────────────────────────

  async putAdmission(record: AdmissionRecord): Promise<void> {
    this.assertInit();
    const retentionExpires = this.opts.retentionPeriod
      ? new Date(new Date(record.timestamp).getTime() + this.opts.retentionPeriod).toISOString()
      : record.retentionExpires ?? null;

    this.db.prepare(`
      INSERT INTO admissions (
        id, exit_marker_id, arrival_marker_id, subject_did, origin_did,
        confirmation_level, policy_name, policy_version, admitted, admission_type,
        counter_signed, counter_sign_meaning, reason_codes, conditions,
        timestamp, quarantined, quarantine_expires, quarantine_resolution,
        minting_justification, retention_expires, policy_snapshot
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.exitMarkerId ?? null,
      record.arrivalMarkerId,
      record.subjectDid,
      record.originDid ?? null,
      record.confirmationLevel ?? null,
      record.policyApplied,
      record.policyVersion ?? null,
      record.admitted ? 1 : 0,
      record.admissionType,
      record.counterSigned ? 1 : 0,
      record.counterSignMeaning ?? null,
      JSON.stringify(record.reasonCodes),
      JSON.stringify(record.conditions),
      record.timestamp,
      record.quarantined ? 1 : 0,
      record.quarantineExpires ?? null,
      record.quarantineResolution ?? null,
      record.mintingJustification ?? null,
      retentionExpires,
      record.policySnapshot ?? null
    );
  }

  async getAdmission(id: string): Promise<AdmissionRecord | undefined> {
    this.assertInit();
    const row = this.db.prepare("SELECT * FROM admissions WHERE id = ?").get(id);
    return row ? this._rowToRecord(row) : undefined;
  }

  async getAdmissionHistory(subjectDid: string): Promise<AdmissionRecord[]> {
    this.assertInit();
    const rows = this.db.prepare(
      "SELECT * FROM admissions WHERE subject_did = ? ORDER BY timestamp DESC"
    ).all(subjectDid);
    return rows.map((r: any) => this._rowToRecord(r));
  }

  async getAdmissionsByPolicy(policyName: string, opts?: { limit?: number; offset?: number }): Promise<AdmissionRecord[]> {
    this.assertInit();
    const limit = opts?.limit ?? 100;
    const offset = opts?.offset ?? 0;
    const rows = this.db.prepare(
      "SELECT * FROM admissions WHERE policy_name = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?"
    ).all(policyName, limit, offset);
    return rows.map((r: any) => this._rowToRecord(r));
  }

  async getQuarantined(): Promise<AdmissionRecord[]> {
    this.assertInit();
    const rows = this.db.prepare(
      "SELECT * FROM admissions WHERE quarantined = 1 AND quarantine_resolution IS NULL ORDER BY timestamp DESC"
    ).all();
    return rows.map((r: any) => this._rowToRecord(r));
  }

  async getExpiredQuarantines(now?: Date): Promise<AdmissionRecord[]> {
    const ts = (now ?? new Date()).toISOString();
    const rows = this.db.prepare(
      "SELECT * FROM admissions WHERE quarantined = 1 AND quarantine_resolution IS NULL AND quarantine_expires IS NOT NULL AND quarantine_expires <= ?"
    ).all(ts);
    return rows.map((r: any) => this._rowToRecord(r));
  }

  /**
   * Contest any admission record (quarantined, rejected, or admitted).
   * Sets contested=1 and contest_reason. For quarantined records, also sets quarantine_resolution='contested'.
   */
  async contestAdmission(recordId: string, reason: string): Promise<boolean> {
    this.assertInit();
    const row = this.db.prepare("SELECT quarantined FROM admissions WHERE id = ?").get(recordId) as any;
    if (!row) return false;
    if (row.quarantined) {
      this.db.prepare(
        "UPDATE admissions SET contested = 1, contest_reason = ?, quarantine_resolution = 'contested' WHERE id = ?"
      ).run(reason, recordId);
    } else {
      this.db.prepare(
        "UPDATE admissions SET contested = 1, contest_reason = ? WHERE id = ?"
      ).run(reason, recordId);
    }
    return true;
  }

  /**
   * Delete all records where retention has expired.
   */
  async purgeExpiredRecords(): Promise<number> {
    this.assertInit();
    const now = new Date().toISOString();
    const claimsResult = this.db.prepare(
      "DELETE FROM claims WHERE exit_marker_id IN (SELECT exit_marker_id FROM admissions WHERE retention_expires IS NOT NULL AND retention_expires <= ?)"
    ).run(now);
    const admResult = this.db.prepare(
      "DELETE FROM admissions WHERE retention_expires IS NOT NULL AND retention_expires <= ?"
    ).run(now);
    return claimsResult.changes + admResult.changes;
  }

  /**
   * Atomically erase all data for a subject (GDPR right-to-erasure).
   */
  async eraseSubject(subjectDid: string): Promise<{ claims: number; admissions: number }> {
    this.assertInit();
    const tx = this.db.transaction(() => {
      const claims = this.db.prepare("DELETE FROM claims WHERE subject_did = ?").run(subjectDid).changes;
      const admissions = this.db.prepare("DELETE FROM admissions WHERE subject_did = ?").run(subjectDid).changes;
      return { claims, admissions };
    });
    return tx();
  }

  /**
   * Resolve expired quarantines with a default resolution.
   */
  async resolveExpiredQuarantines(defaultResolution: "admit" | "reject"): Promise<number> {
    this.assertInit();
    const now = new Date().toISOString();
    const resolution = defaultResolution === "admit" ? "admitted" : "rejected";
    const result = this.db.prepare(
      "UPDATE admissions SET quarantine_resolution = ? WHERE quarantined = 1 AND quarantine_resolution IS NULL AND quarantine_expires IS NOT NULL AND quarantine_expires <= ?"
    ).run(resolution, now);
    return result.changes;
  }

  async deleteAdmissionsBySubject(subjectDid: string): Promise<number> {
    this.assertInit();
    const result = this.db.prepare("DELETE FROM admissions WHERE subject_did = ?").run(subjectDid);
    return result.changes;
  }

  async stats(): Promise<{
    totalClaims: number;
    totalAdmissions: number;
    admitted: number;
    rejected: number;
    quarantined: number;
    minted: number;
    byPolicy: Record<string, number>;
    byConfirmation: Record<string, number>;
  }> {
    this.assertInit();
    const totalClaims = this.db.prepare("SELECT COUNT(*) as c FROM claims").get().c;
    const totalAdmissions = this.db.prepare("SELECT COUNT(*) as c FROM admissions").get().c;
    const admitted = this.db.prepare("SELECT COUNT(*) as c FROM admissions WHERE admitted = 1").get().c;
    const rejected = this.db.prepare("SELECT COUNT(*) as c FROM admissions WHERE admitted = 0").get().c;
    const quarantined = this.db.prepare("SELECT COUNT(*) as c FROM admissions WHERE quarantined = 1 AND quarantine_resolution IS NULL").get().c;
    const minted = this.db.prepare("SELECT COUNT(*) as c FROM admissions WHERE admission_type = 'minted' OR admission_type = 'migration'").get().c;

    const policyRows = this.db.prepare("SELECT policy_name, COUNT(*) as c FROM admissions GROUP BY policy_name").all();
    const byPolicy: Record<string, number> = {};
    for (const r of policyRows as any[]) byPolicy[r.policy_name] = r.c;

    const confRows = this.db.prepare("SELECT confirmation_level, COUNT(*) as c FROM admissions WHERE confirmation_level IS NOT NULL GROUP BY confirmation_level").all();
    const byConfirmation: Record<string, number> = {};
    for (const r of confRows as any[]) byConfirmation[r.confirmation_level] = r.c;

    return { totalClaims, totalAdmissions, admitted, rejected, quarantined, minted, byPolicy, byConfirmation };
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.db?.close();
  }

  private _rowToRecord(row: any): AdmissionRecord {
    return {
      id: row.id,
      exitMarkerId: row.exit_marker_id ?? undefined,
      arrivalMarkerId: row.arrival_marker_id,
      subjectDid: row.subject_did,
      originDid: row.origin_did ?? undefined,
      confirmationLevel: row.confirmation_level ?? undefined,
      policyApplied: row.policy_name,
      policyVersion: row.policy_version ?? "",
      admitted: !!row.admitted,
      admissionType: row.admission_type,
      counterSigned: !!row.counter_signed,
      counterSignMeaning: row.counter_sign_meaning ?? undefined,
      reasonCodes: row.reason_codes ? JSON.parse(row.reason_codes) : [],
      conditions: row.conditions ? JSON.parse(row.conditions) : [],
      timestamp: row.timestamp,
      quarantined: row.quarantined ? true : undefined,
      quarantineExpires: row.quarantine_expires ?? undefined,
      quarantineResolution: row.quarantine_resolution ?? undefined,
      mintingJustification: row.minting_justification ?? undefined,
      retentionExpires: row.retention_expires ?? undefined,
      contested: row.contested ? true : undefined,
      contestReason: row.contest_reason ?? undefined,
      policySnapshot: row.policy_snapshot ?? undefined,
    };
  }
}
