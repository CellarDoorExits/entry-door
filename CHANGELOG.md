# Changelog

## [0.1.0] - 2026-03-05

### Added
- **P-256 (ECDSA) support**: `signArrivalMarker()` accepts algorithm parameter, `verifyArrivalMarker()` auto-detects from proof type.
- **`quickEntryP256()`**: Convenience function for P-256 signed arrivals.
- **P-256 revocation markers**: `createRevocationMarker()` and `verifyRevocationMarker()` now support P-256 alongside Ed25519.
- **Admission policies**: `evaluateAdmission()` with `OPEN_DOOR`, `STRICT`, `EMERGENCY_ONLY` presets.
- **Probation**: `createProbationaryArrival()` and `isProbationComplete()` for conditional admissions.
- **Capability scoping**: `scopeFromExitMarker()`, `createRestrictedScope()`, `mergeScopes()` for fine-grained permissions.
- **Claim tracking**: `InMemoryClaimStore` with GDPR `deleteBySubject()` support.
- **Transfer verification**: `verifyTransfer()` validates complete EXIT→ENTRY chains.
- **Arrival validation**: `validateArrivalMarker()` with `MAX_MARKER_SIZE` limit.
- **Continuity verification**: `verifyContinuity()` checks subject, reference, origin, and temporal ordering.

### Fixed
- **PCR-18**: Revocation markers now support P-256 signatures (was Ed25519-only).

### Security
- ⚠️ **Ephemeral key warning**: `quickEntry()` and `quickEntryP256()` generate ephemeral keys intended for testing/prototyping only. Production deployments should manage their own long-lived keypairs.
