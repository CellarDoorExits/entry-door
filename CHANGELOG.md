# Changelog

## v1.2.1 (2026-03-10)

- **feat:** Full entry-door v2 — policy engine, admit ceremony, counter-signature verification
- **feat:** 7 preset policies (CAUTIOUS, REQUIRE_MUTUAL, PERMISSIVE, LOCKDOWN, etc.)
- **feat:** SQLite persistent store with audit trail
- **feat:** Minting support for fresh agents (no prior departure)
- **fix:** ADV-02 burn-on-reject DoS — unique `pendingClaimId` per attempt
- **fix:** RFC 8785 canonicalization (replaced hand-rolled)
- **fix:** Deep clone exit marker input to prevent mutation
- **docs:** Cross-language test vectors (TS/Python interop)
- 262 tests passing

## v1.2.0 (2026-03-06)

- Initial entry-door with basic arrival/transfer validation
- NIST RFI submission baseline
