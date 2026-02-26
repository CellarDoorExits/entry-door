# 𓉸 ENTRY Protocol Specification v1.0

**Status:** Draft  
**Date:** 2026-02-24  
**Authors:** Cellar Door Contributors  
**Companion to:** EXIT_SPEC v1.1  
**License:** Apache 2.0  
**Brand:** Cellar Door — Passage Protocol · Proof of Passage (PoP)

---

## Abstract

The ENTRY protocol defines a verifiable, cryptographically signed marker for entity arrivals into digital contexts. ENTRY markers enable destination platforms to create authenticated records of admission that link back to EXIT departure markers, establishing **Passage** — the complete, verifiable record of an entity moving between systems. A verified Passage constitutes a **Proof of Passage (PoP)**: cryptographic evidence that an entity departed one context and arrived in another.

Where EXIT records *who left, from where, and under what standing*, ENTRY records *who arrived, where, and under what terms*. Together, EXIT + ENTRY = Passage. This is the **Right of Passage**.

**Core principle:** *Departure is a right. Admission is a privilege.*

EXIT markers cannot be blocked; any entity may depart at any time. ENTRY markers are gatekept; the destination platform has legitimate authority to accept, condition, or deny admission. This asymmetry is intentional and philosophically correct.

---

## 1. Introduction

When an entity arrives at a digital system — whether an AI agent joining a new platform, a participant entering a DAO, or a service onboarding to a new provider — no standardized mechanism exists to create a verifiable record of that arrival linked to a prior departure. ENTRY fills this gap.

An ENTRY marker (Arrival Marker) is a JSON-LD document that records: who arrived, where, when, how they were admitted, and whether their departure was verified. The marker is cryptographically signed by the destination platform and references the EXIT marker from the prior system, creating a cryptographic chain of Passage — a Proof of Passage.

### 1.1 Design Goals

- **Linked:** Every Arrival Marker SHOULD reference a departure via `departureRef`
- **Verifiable:** Every marker is cryptographically signed by the destination
- **Policy-driven:** Destinations define their own admission policies
- **Conditional:** Admission MAY be probationary, scoped, or revocable
- **Replay-resistant:** Each EXIT marker MAY be claimed at most once per destination
- **Non-custodial:** No central registry is required

### 1.2 Relationship to EXIT

ENTRY is the arrival counterpart to EXIT. The two protocols form the **Passage Protocol**: two ceremonies, one protocol. They share:

- Ed25519 cryptographic signing and verification
- Content-addressed identifiers (`urn:entry:{sha256}`, `urn:exit:{sha256}`)
- Deterministic JSON canonicalization (sorted keys, recursive)
- DID-based identity (`did:key`, `did:keri`, etc.)
- Visual hash fingerprinting — door motif (see §22)

ENTRY depends on `cellar-door-exit` for EXIT marker types, signature primitives (`sign`, `verify`, `didFromPublicKey`, `publicKeyFromDid`), key generation, and marker verification (`verifyMarker`, `fromJSON`).

### 1.3 Relationship to Other Standards

| Standard | Relationship |
|---|---|
| W3C Verifiable Credentials | Arrival Markers MAY be wrapped as VCs (destination as issuer) |
| DIDComm | ENTRY markers MAY be transmitted as DIDComm messages |
| A2A (Google/LF) | Orthogonal — A2A handles agent communication; ENTRY handles arrival |
| MCP (Anthropic) | Complementary — ENTRY could bootstrap MCP tool registrations post-arrival |
| RFC 3161 (TSA) | Arrival Markers MAY be anchored via RFC 3161 Timestamp Authority (see §22) |

---

## 2. Terminology

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

- **Subject:** The entity arriving. Identified by a DID carried forward from the EXIT marker.
- **Destination:** The system receiving the entity. Signs the Arrival Marker.
- **Origin:** The system departed. Identified by the EXIT marker's `origin` field.
- **Arrival Marker:** The core signed document recording an arrival.
- **Passage:** The complete verified record of a departure and arrival (EXIT + ENTRY). This specification uses "Passage" exclusively; the term "transfer" is retired.
- **Proof of Passage (PoP):** The cryptographic evidence that a Passage occurred — a verified EXIT→ENTRY chain with valid signatures on both ends.
- **Right of Passage:** The principle that entities have an inherent right to move between systems with verifiable, portable records.
- **Passage Protocol:** The combined EXIT + ENTRY specification for verifiable entity movement.
- **Transition Period:** The temporal gap between the EXIT marker's `timestamp` and the Arrival Marker's `timestamp`. This is the recognized interval during which the entity is in transit — having left the origin but not yet admitted to the destination.
- **Departure Reference (`departureRef`):** The content-addressed ID of the linked EXIT marker.
- **Admission Policy:** A composable set of rules governing whether to admit an arriving entity.
- **Probation:** A time-bounded period of reduced trust following admission.
- **Capability Scope:** The set of allowed and denied capabilities for an arriving entity.
- **Claim:** The act of binding an EXIT marker to an Arrival Marker (one-to-one).
- **Revocation:** The act of invalidating a previously issued Arrival Marker.
- **Unpaired ENTRY ("Birth"):** An Arrival Marker with no corresponding EXIT marker — a new entity with no prior departure.

---

## 3. Core Schema

### 3.1 Arrival Marker

Every valid Arrival Marker MUST contain the following fields.

| # | Field | Type | Description |
|---|---|---|---|
| 1 | `@context` | string | MUST be `"https://cellar-door.dev/entry/v1"` |
| 2 | `id` | string (URI) | Globally unique identifier. MUST start with `"urn:entry:"`. SHOULD be content-addressed (`urn:entry:{sha256}`) |
| 3 | `departureRef` | string | ID of the linked EXIT marker. MUST be present. For unpaired ENTRYs, see §3.6 |
| 4 | `departureOrigin` | string (URI) | Origin platform from the EXIT marker |
| 5 | `destination` | string (URI) | Where the entity is arriving (this platform) |
| 6 | `subject` | string (DID) | DID of the arriving entity. MUST be a valid DID |
| 7 | `timestamp` | string (ISO 8601) | When the arrival was recorded. MUST be UTC |
| 8 | `admissionType` | enum | How the entity was admitted: `automatic`, `reviewed`, or `conditional` |
| 9 | `verificationResult` | object | Result of verifying the linked EXIT marker (§3.2) |
| — | `proof` | object | Cryptographic signature by the destination platform (§3.3) |

### 3.2 Verification Result

The `verificationResult` object records the outcome of EXIT marker verification at arrival time.

| Field | Type | Description |
|---|---|---|
| `valid` | boolean | Whether the EXIT marker passed structural and cryptographic verification |
| `errors` | array of string | Any errors encountered during verification |

### 3.3 Proof Structure

The `proof` object MUST contain:

| Field | Type | Description |
|---|---|---|
| `type` | string | MUST be `"Ed25519Signature2020"` |
| `created` | string (ISO 8601) | When the proof was created |
| `verificationMethod` | string | DID or key URI of the destination's signing key |
| `proofValue` | string | Base64-encoded Ed25519 signature |

The data signed MUST be the canonical JSON form (§11) of the marker excluding the `proof` field.

**Note:** Unlike EXIT markers (signed by the subject), Arrival Markers are signed by the **destination platform**. The destination is attesting: "We verified this departure and admitted this entity." This signature constitutes the destination's contribution to the Proof of Passage.

### 3.4 Optional Fields

| Field | Type | Description |
|---|---|---|
| `conditions` | array of string | Conditions on admission. MUST be present when `admissionType` is `conditional` |
| `probation` | ProbationInfo | Probation metadata (§6) |
| `capabilityScope` | CapabilityScope | Capability restrictions (§7) |

### 3.5 Admission Types

| Value | Description | When Used |
|---|---|---|
| `automatic` | EXIT marker verified successfully; no further review needed | Default when verification passes |
| `reviewed` | Manual or extended review was performed | When verification fails or policy requires review |
| `conditional` | Admitted with restrictions or probation | When probation, capability scoping, or other conditions apply |

When `admissionType` is `conditional`, the `conditions` field SHOULD enumerate the specific conditions (e.g., `"probation-86400000ms"`, `"restriction:no-external-api"`).

### 3.6 Unpaired ENTRYs ("Births")

Not every arrival has a prior departure. An entity may be newly created, bootstrapped, or otherwise originating without a history in another system. These are **unpaired ENTRYs** or colloquially "births."

Unpaired ENTRYs are valid. Implementations MUST NOT reject an Arrival Marker solely because the `departureRef` cannot be resolved to a known EXIT marker. In this case:

- `departureRef` SHOULD be set to a sentinel value (e.g., `"urn:exit:none"` or `"urn:exit:genesis"`)
- `departureOrigin` SHOULD indicate the origination context
- `verificationResult.valid` SHOULD be `false` with an explanatory error (e.g., `"No EXIT marker presented"`)
- `admissionType` SHOULD be `reviewed` or `conditional`

---

## 4. Admission Policies

Admission policies are composable rule sets that determine whether an arriving entity is admitted. Policies are the destination platform's prerogative — the protocol defines the mechanism, not the threshold.

### 4.1 AdmissionPolicy Structure

| Field | Type | Description |
|---|---|---|
| `requireVerifiedDeparture` | boolean | Require the EXIT marker to have a valid cryptographic proof |
| `maxDepartureAge` | number (ms) | Maximum age of the EXIT marker. Markers older than this are rejected |
| `allowedExitTypes` | array of string | Permitted EXIT types (e.g., `["voluntary"]`). Empty or absent = all allowed |
| `requiredModules` | array of string | EXIT modules that must be present (e.g., `["lineage", "stateSnapshot"]`) |

### 4.2 Evaluation

Policy evaluation produces an `AdmissionResult`:

| Field | Type | Description |
|---|---|---|
| `admitted` | boolean | Whether the entity passes the policy |
| `conditions` | array of string | Conditions attached to admission |
| `reasons` | array of string | Reasons for denial (empty if admitted) |

Evaluation checks, in order:

1. **Exit type:** If `allowedExitTypes` is non-empty and `exitMarker.exitType` is not in the list, deny.
2. **Departure age:** If the EXIT marker's age exceeds `maxDepartureAge`, deny.
3. **Required modules:** If any required module is absent from the EXIT marker, deny.
4. **Verified departure:** If `requireVerifiedDeparture` is true and the EXIT marker has no proof, deny.

### 4.3 Preset Policies

The following preset policies are defined and exported as constants:

#### OPEN_DOOR

Accept any entity with a valid EXIT signature.

```
requireVerifiedDeparture: true
```

#### STRICT

Voluntary departures only, less than 24 hours old, with lineage and state snapshot modules.

```
requireVerifiedDeparture: true
maxDepartureAge: 86,400,000 (24h)
allowedExitTypes: ["voluntary"]
requiredModules: ["lineage", "stateSnapshot"]
```

#### EMERGENCY_ONLY

Accept only emergency exits. Useful for systems that serve as emergency shelters for displaced agents.

```
requireVerifiedDeparture: true
allowedExitTypes: ["emergency"]
```

### 4.4 Anti-Coordination

Platforms implementing ENTRY policies MUST NOT coordinate admission decisions with other platforms. Specifically:

- Platforms MUST NOT share admission denial lists with other platforms
- Platforms MUST NOT participate in collective blocking agreements
- Platforms MUST NOT use shared databases of denied agents for admission decisions
- Each platform MUST make admission decisions independently based on its own policies

Violation of these requirements may constitute illegal group boycotts under antitrust law (Sherman Act §1, EU TFEU Art. 101).

> **Note:** Platforms MAY maintain internal security exclusion lists outside the scope of this specification. The ENTRY protocol intentionally does not standardize exclusion mechanisms.

### 4.5 Custom Policies

Implementations SHOULD support custom policies. The `AdmissionPolicy` structure is intentionally minimal and composable. Destinations MAY layer additional checks (reputation thresholds, capability requirements, identity verification) on top of the base policy evaluation.

---

## 5. Passage Verification

A **Passage** is the complete, verified record of an entity moving between systems — the core unit of the Passage Protocol. Passage verification confirms the integrity of the entire chain: EXIT → transition → ENTRY. A successfully verified Passage constitutes a **Proof of Passage (PoP)**.

### 5.1 PassageRecord Structure

> **API Note:** The TypeScript export is currently named `TransferRecord` and `verifyTransfer()` for backward compatibility. These will be renamed to `PassageRecord` and `verifyPassage()` in v0.2.0.

| Field | Type | Description |
|---|---|---|
| `exit` | ExitMarker | The departure marker |
| `arrival` | ArrivalMarker | The arrival marker |
| `continuity` | ContinuityResult | Result of continuity verification (§5.3) |
| `passageTime` | number (ms) | Duration of the transition period (arrival timestamp − departure timestamp). (API field: `transferTime` until v0.2.0) |
| `verified` | boolean | Whether the full Passage is verified — i.e., this record constitutes a valid Proof of Passage (all checks pass) |
| `errors` | array of string | Errors from any stage, prefixed by stage (`EXIT:`, `ARRIVAL:`, `CONTINUITY:`) |

### 5.2 Verification Stages

`verifyPassage()` (exported as `verifyTransfer()` until v0.2.0) performs three stages:

1. **EXIT verification:** Verify the EXIT marker's cryptographic signature using `verifyMarker()` from `cellar-door-exit`.
2. **ARRIVAL verification:** Verify the Arrival Marker's cryptographic signature (§3.3).
3. **Continuity verification:** Verify the linkage between EXIT and ENTRY (§5.3).

All three stages MUST pass for `verified` to be `true`. Errors from each stage are collected and prefixed.

### 5.3 Continuity Verification

`verifyContinuity()` checks the logical linkage between an EXIT marker and an Arrival Marker:

1. **Departure reference:** `arrivalMarker.departureRef` MUST equal `exitMarker.id`.
2. **Subject match:** `arrivalMarker.subject` MUST equal `exitMarker.subject`. The same DID must appear on both sides.
3. **Origin match:** `arrivalMarker.departureOrigin` MUST equal `exitMarker.origin`.
4. **Temporal ordering:** `arrivalMarker.timestamp` MUST NOT be before `exitMarker.timestamp`. The arrival cannot precede the departure.
5. **EXIT validity:** The EXIT marker MUST pass cryptographic verification.

### 5.4 The Transition Period

The **transition period** is the temporal gap between `exitMarker.timestamp` and `arrivalMarker.timestamp`:

```
transitionPeriod = arrivalMarker.timestamp − exitMarker.timestamp
```

During this interval, the entity has departed the origin but has not yet been admitted to the destination. The entity is "in transit."

Properties of the transition period:

- It MUST be non-negative (arrival cannot precede departure)
- It has no defined maximum (an entity may take arbitrarily long to arrive)
- A transition period of zero is valid (simultaneous departure and arrival)
- The transition period is recorded as `passageTime` (API: `transferTime`) in the PassageRecord
- Destinations MAY use `maxDepartureAge` in admission policies to bound acceptable transition periods

The transition period is a **recognized state** — the entity is neither at the origin nor at the destination. Systems SHOULD NOT treat an entity as present at the origin after its EXIT marker is created, nor at the destination before its Arrival Marker is created.

### 5.5 Checkpoint EXIT Markers

EXIT markers MAY be **pre-signed** for emergency scenarios ("checkpoint" markers). A checkpoint EXIT marker is created in advance and held in escrow, to be published if the origin becomes unresponsive or hostile.

Checkpoint markers are valid EXIT markers and MUST be accepted by ENTRY verification. The pre-signing pattern means:

- The EXIT marker's `timestamp` may predate the actual departure
- The transition period may appear longer than the actual transit
- Verifiers SHOULD NOT penalize checkpoint markers for age if `exitType` is `emergency`

---

## 6. Probation

Probation is a time-bounded period of reduced trust following admission. It mirrors institutional patterns: employment probation, medical credentialing FPPE (Focused Professional Practice Evaluation), conditional residence.

### 6.1 ProbationInfo Structure

| Field | Type | Description |
|---|---|---|
| `duration` | number (ms) | Length of the probation period |
| `restrictions` | array of string | Restrictions during probation (e.g., `"no-external-api"`, `"read-only"`, `"supervised"`) |
| `reviewRequired` | boolean | Whether human/admin review is required before probation ends |
| `startedAt` | string (ISO 8601) | When probation started (typically the arrival timestamp) |

### 6.2 Creating Probationary Arrivals

`createProbationaryArrival()` creates an Arrival Marker with `admissionType: "conditional"` and embedded probation metadata. The `conditions` array is automatically populated with:

- `probation-{duration}ms`
- `restriction:{name}` for each restriction

### 6.3 Probation Completion

`isProbationComplete()` checks whether probation has elapsed:

```
complete = (now >= startedAt + duration)
```

If `probation` is absent from the Arrival Marker, probation is considered complete (no probation was imposed).

**Note:** `isProbationComplete()` checks only temporal completion. If `reviewRequired` is `true`, the destination MUST additionally confirm that the review has been performed before granting full status.

### 6.4 Probation Semantics

- Probation is the **destination's prerogative**. The protocol defines the data structure; the destination defines the restrictions.
- Probation SHOULD be proportionate to risk. Low-confidence arrivals warrant longer probation and more restrictions.
- Restrictions are free-text strings. Common values include: `no-external-api`, `read-only`, `supervised`, `rate-limited`, `no-delegation`.
- Probation MAY be terminated early by the destination (by issuing a new Arrival Marker without probation or by policy decision).
- Probation violations MAY trigger revocation (§9).

---

## 7. Capability Scoping

Capability scoping determines what an arriving entity is allowed to do. It provides least-privilege access by default, with explicit grants.

### 7.1 CapabilityScope Structure

| Field | Type | Description |
|---|---|---|
| `allowed` | array of string | Capabilities the entity is permitted to exercise |
| `denied` | array of string | Capabilities explicitly denied |
| `expires` | string (ISO 8601) | When these capability grants expire. OPTIONAL |

### 7.2 Deriving Scope from EXIT Markers

`scopeFromExitMarker()` derives initial capabilities from the presence of EXIT modules:

| EXIT Module | Derived Capability |
|---|---|
| Module A (lineage) | `identity-continuity` |
| Module B (stateSnapshot) | `state-portability` |
| Module C (dispute) | `dispute-context` |
| Module D (economic) | `economic-portability` |
| Module E (metadata) | `metadata-access` |
| Module F (crossDomain) | `cross-domain-reference` |

All entities receive `basic-interaction` regardless of EXIT modules.

### 7.3 Restricted Scopes

`createRestrictedScope()` creates a scope with explicit allowed/denied lists and optional expiry. This is used when the destination wants to override the EXIT-derived scope.

### 7.4 Scope Merging

`mergeScopes()` combines two capability scopes with the following rules:

1. **Union of allowed:** All capabilities from both scopes are combined.
2. **Union of denied:** All denials from both scopes are combined.
3. **Denied wins:** Any capability that appears in both `allowed` and `denied` is removed from `allowed`. Denial is authoritative.
4. **Earliest expiry:** If both scopes have an `expires`, the earlier one is used.

### 7.5 Capability Semantics

- Capabilities are free-text strings. The protocol does not define a capability vocabulary — that is domain-specific.
- Denied capabilities MUST be enforced. `denied` is a hard blocklist.
- Expired scopes SHOULD be treated as having no allowed capabilities (deny-by-default).
- Capability scopes MAY be updated post-admission by issuing new scope records (outside the scope of this specification).

---

## 8. Claim Tracking

Claim tracking prevents replay attacks by ensuring each EXIT marker is consumed at most once per destination. Without claim tracking, a single EXIT marker could be used to gain admission to multiple destinations simultaneously.

### 8.1 ClaimStore Interface

| Method | Description |
|---|---|
| `claim(exitMarkerId, arrivalMarkerId)` | Bind an EXIT marker to an Arrival Marker. Returns `true` if successful (unclaimed), `false` if already claimed |
| `isClaimed(exitMarkerId)` | Check if an EXIT marker has been claimed |
| `getArrivalId(exitMarkerId)` | Get the Arrival Marker ID that claimed this EXIT marker |
| `revoke(arrivalMarkerId)` | Revoke an arrival, releasing the EXIT marker claim. Returns `true` if found |
| `deleteBySubject(subjectDid)` | GDPR Art. 17 — delete all claims involving a given subject DID. Returns count deleted |

All methods are async to support distributed storage backends (Redis, databases, ledgers) with proper locking.

### 8.2 In-Memory Implementation

`InMemoryClaimStore` provides a reference implementation using in-memory Maps with:

- Forward index: `exitMarkerId → arrivalMarkerId`
- Reverse index: `arrivalMarkerId → exitMarkerId` (for revocation)
- Subject index: `subjectDid → Set<exitMarkerId>` (for GDPR deletion)

**For production deployments**, implementations MUST use a persistent, distributed store with proper concurrency control. The in-memory implementation is for testing only.

### 8.3 Claim Semantics

- An EXIT marker MAY be claimed at most once per destination. Different destinations MAY independently claim the same EXIT marker (an entity can arrive at multiple places from the same departure).
- Claiming is atomic: it either succeeds entirely or fails entirely.
- Revoking an arrival releases its claim, making the EXIT marker available for re-claiming.
- GDPR deletion MUST remove all claim records for a subject, including forward, reverse, and subject indices.

---

## 9. Revocation

Revocation invalidates a previously issued Arrival Marker. It is the destination's mechanism for post-admission ejection — when fraud is discovered, policies are violated, or conditions change.

### 9.1 RevocationMarker Structure

| Field | Type | Description |
|---|---|---|
| `type` | string | MUST be `"RevocationMarker"` |
| `arrivalRef` | string | ID of the Arrival Marker being revoked |
| `subject` | string (DID) | Subject of the revoked arrival |
| `authority` | string (DID) | DID of the revoking authority |
| `reason` | string | Human-readable reason for revocation |
| `timestamp` | string (ISO 8601) | When the revocation was issued |
| `proof` | object | Ed25519 signature by the revoking authority |

### 9.2 Authority Requirements

- The revoking authority MUST be the destination platform that signed the original Arrival Marker.
- The `authority` DID MUST match the `proof.verificationMethod` on the original Arrival Marker.
- `createRevocationMarker()` enforces this by comparing the revoker's DID against the arrival's signer.

### 9.3 Revocation Verification

`verifyRevocationMarker()` checks:

1. The proof is present and the signature is valid.
2. The `authority` matches the `proof.verificationMethod` (self-consistency).
3. If the original Arrival Marker is provided, the `authority` matches the arrival's signer (authorization).

### 9.4 Revocation Checking

`isRevoked()` checks whether an arrival ID appears in a list of revocation markers. Implementations SHOULD maintain a revocation index for efficient lookup.

### 9.5 Revocation Semantics

- Revocation is the **destination's prerogative**. Only the destination that issued the Arrival Marker can revoke it.
- Revocation is permanent within the issuing destination. The entity may re-apply (present a new EXIT marker or request re-admission), but the revoked Arrival Marker cannot be un-revoked.
- Revocation SHOULD trigger claim release (§8) so the EXIT marker can be re-claimed if the entity seeks admission elsewhere.
- A `reason` MUST be provided. Revocations without reasons are non-compliant.

---

## 10. Departure Verification

ENTRY's first duty is verifying the EXIT marker presented by an arriving entity.

### 10.1 verifyDeparture

`verifyDeparture()` wraps `cellar-door-exit`'s `verifyMarker()` and returns a structured `VerificationResult`:

- `valid`: Whether the EXIT marker passes structural and cryptographic checks.
- `errors`: List of errors found.

### 10.2 verifyDepartureJSON

`verifyDepartureJSON()` accepts a raw JSON string, parses it using `cellar-door-exit`'s `fromJSON()`, and then runs `verifyDeparture()`. Returns both the parsed EXIT marker and the verification result. Parse failures are captured as verification errors.

---

## 11. Canonicalization and Content Addressing

### 11.1 Canonical JSON

ENTRY uses the same deterministic JSON serialization as EXIT:

1. Objects: keys sorted lexicographically, serialized without whitespace
2. Arrays: elements in order
3. Primitives: standard JSON serialization
4. Recursive: nested objects are sorted at every level
5. `null` and `undefined` are serialized via `JSON.stringify`

### 11.2 Content-Addressed IDs

The `id` field is computed as:

```
id = "urn:entry:" + SHA-256(canonicalize(marker_without_proof_and_id))
```

This ensures:

- Different markers produce different IDs (collision resistance)
- The same marker content always produces the same ID (determinism)
- Verifiers MAY verify the ID by recomputing the hash

---

## 12. Signing and Verification

### 12.1 Signing

`signArrivalMarker()` signs an Arrival Marker with the destination's Ed25519 key pair:

1. Remove the existing `proof` field (if any).
2. Canonicalize the remaining fields.
3. Sign the canonical bytes with the destination's private key.
4. Attach a proof object with `type: "Ed25519Signature2020"`.

### 12.2 Verification

`verifyArrivalMarker()` verifies the signature:

1. Extract the `proof` object.
2. Resolve the `verificationMethod` DID to a public key.
3. Remove the `proof` and canonicalize.
4. Verify the signature against the canonical bytes.

Returns `{ valid, errors }`.

---

## 13. Validation

### 13.1 Structural Validation

`validateArrivalMarker()` performs structural validation on an Arrival Marker:

1. Marker MUST be a non-null object.
2. Serialized size MUST NOT exceed `MAX_MARKER_SIZE` (1,048,576 bytes / 1 MB).
3. `@context` MUST equal `"https://cellar-door.dev/entry/v1"`.
4. `id` MUST be a string starting with `"urn:entry:"`.
5. `departureRef` MUST be a non-empty string.
6. `departureOrigin` MUST be a non-empty string.
7. `destination` MUST be a non-empty string.
8. `subject` MUST match the DID format regex: `^did:[a-z0-9]+:[a-zA-Z0-9._:%-]+$`.
9. `timestamp` MUST be valid ISO 8601 UTC (matching `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$`).
10. `admissionType` MUST be one of: `automatic`, `reviewed`, `conditional`.
11. `verificationResult` MUST be present with a boolean `valid` and array `errors`.
12. `conditions`, if present, MUST be an array of strings.

---

## 14. Convenience Functions

### 14.1 quickEntry

`quickEntry()` provides a one-shot arrival flow:

1. Parse the EXIT marker from JSON.
2. Verify the departure.
3. Create an unsigned Arrival Marker.
4. Sign with a fresh destination keypair.
5. Verify continuity between EXIT and ENTRY.

Returns a `QuickEntryResult`: `{ arrivalMarker, exitMarker, continuity }`.

This is intended for testing and prototyping. Production implementations SHOULD use the individual functions with managed key pairs.

### 14.2 parseDuration

`parseDuration()` converts human-readable duration strings to milliseconds:

| Suffix | Meaning |
|---|---|
| `ms` | Milliseconds |
| `s` | Seconds |
| `m` | Minutes |
| `h` | Hours |
| `d` | Days |

Example: `"24h"` → `86,400,000`

---

## 15. Lifecycle: Arrival Ceremony

While EXIT defines a formal ceremony state machine (7 states, 3 paths), ENTRY's ceremony is simpler because the destination has unilateral authority.

### 15.1 Arrival Flow

```
APPROACHING → VERIFYING → ADMITTED → ACTIVE
                  │
                  ├──→ DENIED (terminal)
                  │
                  └──→ ADMITTED (conditional) → PROBATION → ACTIVE
```

| State | Description |
|---|---|
| APPROACHING | Entity presents EXIT marker to destination |
| VERIFYING | Destination validates EXIT marker and evaluates admission policy |
| DENIED | Terminal — admission refused. No Arrival Marker is created |
| ADMITTED | Arrival Marker created and signed. Entity is present in the destination |
| PROBATION | Subset of ADMITTED — entity is admitted with restrictions |
| ACTIVE | Full participation — probation complete or no probation imposed |

### 15.2 Invariants

- DENIED is terminal. No Arrival Marker is created for denied arrivals.
- ADMITTED entities MAY be revoked (→ effectively DENIED after the fact).
- PROBATION is a sub-state of ADMITTED, not a separate state.
- Unlike EXIT, where disputes never block departure, **the destination MAY block admission**. This is the fundamental asymmetry.

---

## 16. Passage Lifecycle Chains

Passage creates a lifecycle chain across systems:

```
EXIT₁ → ENTRY₁ → EXIT₂ → ENTRY₂ → EXIT₃ → ENTRY₃ → ...
```

Each Arrival Marker's `departureRef` points to the preceding EXIT marker. Each subsequent EXIT marker SHOULD reference the Arrival Marker (via Module A lineage or similar mechanism) to complete the chain.

### 16.1 Chain Properties

- The chain is append-only. Markers cannot be removed from the chain (though they can be revoked or sunset).
- Gaps are permitted. An entity may EXIT without a subsequent ENTRY (departure into the void) or ENTER without a prior EXIT (birth / unpaired ENTRY).
- The chain is verifiable end-to-end. Any verifier can walk the chain, checking each Passage independently. A fully verified chain constitutes a **Passage history** — the entity's complete, portable provenance.

### 16.2 Unpaired Markers

| Scenario | EXIT | ENTRY | Meaning |
|---|---|---|---|
| Normal Passage | ✓ | ✓ | Entity departed origin, arrived at destination |
| Departure into void | ✓ | ✗ | Entity left but hasn't arrived anywhere (yet) |
| Birth / Genesis | ✗ | ✓ | Entity is new — no prior departure |
| Orphan | ✓ | ✗ (stale) | Entity departed long ago; transition period exceeded reasonable bounds |

All four scenarios are valid states. Systems MUST NOT assume that every EXIT will be followed by an ENTRY, or that every ENTRY was preceded by an EXIT.

---

## 17. Security Considerations

### 17.1 Replay Attacks

Without claim tracking (§8), a single EXIT marker could be used to gain admission to the same destination multiple times or to claim the same departure at multiple destinations. Implementations SHOULD use claim tracking to prevent same-destination replay.

**Note:** Cross-destination replay (using one EXIT to arrive at multiple destinations) may be intentional. The protocol does not prevent it — each destination independently evaluates the same EXIT marker. If exclusive claiming is desired, a shared claim registry is required (outside the scope of this specification).

### 17.2 Forgery

Arrival Markers are signed by the destination, not the arriving entity. This means:

- A malicious entity cannot forge its own Arrival Marker (it doesn't have the destination's private key).
- A malicious destination CAN forge Arrival Markers for entities that never arrived. This is mitigated by the entity's ability to dispute and by the EXIT marker's independent verifiability.

### 17.3 Revocation Lag

There is an inherent delay between discovering grounds for revocation and issuing a RevocationMarker. During this window, the entity operates with a valid Arrival Marker. Implementations SHOULD minimize this lag. Real-time revocation checking is RECOMMENDED for high-trust contexts.

### 17.4 Claim Store Availability

If the claim store is unavailable, new arrivals cannot be processed (claims cannot be checked or recorded). Implementations MUST handle claim store failures gracefully — either queuing arrivals or failing closed (denying admission until the store recovers).

### 17.5 EXIT Marker Tampering

ENTRY relies on the EXIT marker's cryptographic integrity. If an arriving entity presents a modified EXIT marker, `verifyDeparture()` will detect the tampering (signature mismatch). Destinations MUST NOT admit entities whose EXIT markers fail verification unless policy explicitly allows it (e.g., for reviewed admissions of entities with damaged or expired markers).

### 17.6 Subject DID Continuity

ENTRY verifies that the `subject` DID matches between EXIT and ENTRY markers. This does NOT prove the presenting entity controls that DID — only that the markers are consistent. Full subject authentication requires additional mechanisms (e.g., challenge-response proof of DID control) that are outside this specification's scope.

### 17.7 Privacy

Arrival Markers contain personal data (subject DID, origin, destination, timestamps). GDPR and equivalent privacy regulations apply. The `ClaimStore.deleteBySubject()` method supports GDPR Art. 17 right-to-erasure requests. Implementations SHOULD encrypt Arrival Markers at rest.

### 17.8 Trojan Horse

A malicious agent may present valid credentials (legitimate EXIT marker, real DID) but harbor harmful intent. ENTRY cannot detect this — it verifies identity and provenance, not intent. Destinations MUST implement behavioral monitoring independently of ENTRY. Probation (§6) provides a structural mitigation by limiting capabilities during the initial assessment period.

---

## 18. GDPR Compliance

- `ClaimStore.deleteBySubject()` supports Art. 17 right-to-erasure
- Arrival Markers contain personal data under Art. 4(1) — subject DID, movement history
- Implementations MUST conduct a Data Protection Impact Assessment (Art. 35) before processing Arrival Markers in EU jurisdictions
- Data minimization: Arrival Markers SHOULD contain only the fields necessary for admission
- Encryption at rest is RECOMMENDED for all stored markers

---

## 19. Appendix: Test Vectors

### 19.1 Minimal Automatic Arrival

```json
{
  "@context": "https://cellar-door.dev/entry/v1",
  "id": "urn:entry:abc123def456",
  "departureRef": "urn:exit:aaa111bbb222",
  "departureOrigin": "https://origin-platform.com",
  "destination": "https://destination-platform.com",
  "subject": "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK",
  "timestamp": "2026-02-24T01:00:00.000Z",
  "admissionType": "automatic",
  "verificationResult": {
    "valid": true,
    "errors": []
  },
  "proof": {
    "type": "Ed25519Signature2020",
    "created": "2026-02-24T01:00:00.000Z",
    "verificationMethod": "did:key:z6MkDestinationKey123",
    "proofValue": "zArrival..."
  }
}
```

### 19.2 Conditional Arrival with Probation

```json
{
  "@context": "https://cellar-door.dev/entry/v1",
  "id": "urn:entry:cond456",
  "departureRef": "urn:exit:dep789",
  "departureOrigin": "https://sketchy-platform.io",
  "destination": "https://careful-platform.com",
  "subject": "did:key:z6MkNewArrival789",
  "timestamp": "2026-02-24T02:00:00.000Z",
  "admissionType": "conditional",
  "conditions": [
    "probation-604800000ms",
    "restriction:no-external-api",
    "restriction:rate-limited"
  ],
  "verificationResult": {
    "valid": true,
    "errors": []
  },
  "probation": {
    "duration": 604800000,
    "restrictions": ["no-external-api", "rate-limited"],
    "reviewRequired": true,
    "startedAt": "2026-02-24T02:00:00.000Z"
  },
  "capabilityScope": {
    "allowed": ["basic-interaction", "identity-continuity"],
    "denied": ["economic-portability", "cross-domain-reference"]
  },
  "proof": {
    "type": "Ed25519Signature2020",
    "created": "2026-02-24T02:00:01.000Z",
    "verificationMethod": "did:key:z6MkCarefulPlatform456",
    "proofValue": "zConditional..."
  }
}
```

### 19.3 Unpaired ENTRY (Birth)

```json
{
  "@context": "https://cellar-door.dev/entry/v1",
  "id": "urn:entry:genesis001",
  "departureRef": "urn:exit:none",
  "departureOrigin": "urn:origin:genesis",
  "destination": "https://first-home.com",
  "subject": "did:key:z6MkBrandNewAgent001",
  "timestamp": "2026-02-24T00:00:00.000Z",
  "admissionType": "reviewed",
  "verificationResult": {
    "valid": false,
    "errors": ["No EXIT marker presented"]
  },
  "proof": {
    "type": "Ed25519Signature2020",
    "created": "2026-02-24T00:00:00.000Z",
    "verificationMethod": "did:key:z6MkFirstHome789",
    "proofValue": "zGenesis..."
  }
}
```

### 19.4 Revocation Marker

```json
{
  "type": "RevocationMarker",
  "arrivalRef": "urn:entry:abc123def456",
  "subject": "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK",
  "authority": "did:key:z6MkDestinationKey123",
  "reason": "Fraudulent EXIT marker discovered post-admission",
  "timestamp": "2026-02-25T08:00:00.000Z",
  "proof": {
    "type": "Ed25519Signature2020",
    "created": "2026-02-25T08:00:00.000Z",
    "verificationMethod": "did:key:z6MkDestinationKey123",
    "proofValue": "zRevoke..."
  }
}
```

---

## 20. Appendix: Full TypeScript Schema (Normative)

The canonical TypeScript type definitions are maintained in `src/types.ts`. The complete list of types:

### Enums / Union Types
- `AdmissionType`: `"automatic"` | `"reviewed"` | `"conditional"`

### Core Interfaces
- `ArrivalMarker` — The core arrival record (§3.1)
- `ArrivalProof` — Ed25519 signature on the arrival marker (§3.3)
- `VerificationResult` — EXIT marker verification outcome (§3.2)
- `ProbationInfo` — Probation metadata (§6.1)
- `CapabilityScope` — Allowed/denied capabilities (§7.1)
- `ContinuityResult` — Continuity verification outcome (§5.3)
- `CreateArrivalOpts` — Options for creating an arrival marker

### Policy Interfaces
- `AdmissionPolicy` — Composable admission rules (§4.1)
- `AdmissionResult` — Policy evaluation outcome (§4.2)

### Probation Interfaces
- `ProbationConfig` — Configuration for probationary arrivals (§6)

### Claim Tracking Interfaces
- `ClaimStore` — Abstract claim storage interface (§8.1)
- `InMemoryClaimStore` — Reference in-memory implementation (§8.2)

### Revocation Interfaces
- `RevocationMarker` — Signed revocation record (§9.1)

### Passage Interfaces
- `TransferRecord` — Complete Passage record (§5.1). To be renamed `PassageRecord` in v0.2.0

### Verification / Validation Interfaces
- `ArrivalVerificationResult` — Signature verification outcome (§12.2)
- `ValidationResult` — Structural validation outcome (§13)
- `QuickEntryResult` — Return type for `quickEntry()` (§14.1)

### Constants
- `ENTRY_CONTEXT_V1` — `"https://cellar-door.dev/entry/v1"` (§3.1)
- `MAX_MARKER_SIZE` — `1048576` (1 MB maximum marker size, §13.1)
- `OPEN_DOOR` — Preset admission policy (§4.3)
- `STRICT` — Preset admission policy (§4.3)
- `EMERGENCY_ONLY` — Preset admission policy (§4.3)

---

## 21. Appendix: Exported Functions (Normative)

| Function | Module | Description |
|---|---|---|
| `verifyDeparture()` | verify-departure | Verify an EXIT marker object |
| `verifyDepartureJSON()` | verify-departure | Parse and verify an EXIT marker from JSON |
| `createArrivalMarker()` | arrival | Create an unsigned Arrival Marker linked to an EXIT marker |
| `canonicalize()` | arrival | Deterministic JSON canonicalization |
| `computeArrivalId()` | arrival | Compute content-addressed ID for an Arrival Marker |
| `signArrivalMarker()` | sign | Sign an Arrival Marker with Ed25519 |
| `verifyArrivalMarker()` | sign | Verify an Arrival Marker's signature |
| `verifyContinuity()` | continuity | Verify EXIT→ENTRY linkage |
| `evaluateAdmission()` | admission-policy | Evaluate an EXIT marker against an admission policy |
| `parseDuration()` | admission-policy | Parse duration strings to milliseconds |
| `createProbationaryArrival()` | probation | Create a probationary Arrival Marker |
| `isProbationComplete()` | probation | Check if probation has elapsed |
| `scopeFromExitMarker()` | capability-scope | Derive capabilities from EXIT modules |
| `createRestrictedScope()` | capability-scope | Create a restricted capability scope |
| `mergeScopes()` | capability-scope | Merge two capability scopes (denied wins) |
| `createRevocationMarker()` | revocation | Create a signed revocation |
| `verifyRevocationMarker()` | revocation | Verify a revocation's signature and authority |
| `isRevoked()` | revocation | Check if an arrival has been revoked |
| `verifyTransfer()` | transfer | End-to-end Passage verification. To be renamed `verifyPassage()` in v0.2.0 |
| `validateArrivalMarker()` | validation | Structural validation of an Arrival Marker |
| `quickEntry()` | convenience | One-shot parse → verify → create → sign → check continuity |

---

## 22. Appendix: Cross-References to EXIT Spec

### 22.1 Visual Door Support

EXIT_SPEC v1.1 defines visual hash fingerprinting via door ASCII art and SVG rendering (see EXIT_SPEC §12.x "Visual Representations"). ENTRY markers are supported by the visual system:

- `renderDoorASCII(hash, isEntry=true)` renders an ENTRY-specific door using the **𓉸➜** motif (arriving through the door)
- `renderDoorSVG(hash, isEntry=true)` produces an SVG door visualization
- `shortHash(hash, isEntry=true)` produces a short hash prefixed with `𓉸➜` instead of `➜𓉸` (EXIT motif)
- Color palettes are derived from the marker hash via `hashToColors()`

Visual doors are **decorative and informational**, NOT a security mechanism. They provide a human-recognizable fingerprint of a marker's identity.

### 22.2 RFC 3161 Timestamp Anchoring

EXIT_SPEC v1.1 defines RFC 3161 TSA timestamp anchoring (see EXIT_SPEC §11.3). Arrival Markers MAY also be anchored via TSA:

- `anchorWithTSA()` can anchor any content-addressed marker, including Arrival Markers
- TSA receipts provide independent third-party proof of marker existence at a given time
- TSA verification is **structural only** (ASN.1 parsing), not full cryptographic verification — see EXIT_SPEC security caveats

Anchoring Arrival Markers via TSA is RECOMMENDED for high-assurance Passage verification, as it provides non-repudiable proof that both the departure and arrival occurred within their claimed timeframes.

### 22.3 Git Ledger Anchoring

EXIT_SPEC v1.1 defines git-backed append-only ledger anchoring (see EXIT_SPEC §11.4). Arrival Markers MAY be anchored to git ledgers using the same mechanism, providing an auditable, append-only record of all arrivals at a destination.

---

## 23. Appendix: Package Information

- **Package:** `cellar-door-entry`
- **Test suite:** 77 tests (as of 2026-02-24)
- **Dependencies:** `cellar-door-exit` (peer dependency for EXIT types, signing, verification)
- **Spec version:** ENTRY v1.0, companion to EXIT v1.1
- **Context URI:** `https://cellar-door.dev/entry/v1` (exported as `ENTRY_CONTEXT_V1`)

---

## References

- [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) — Key words for use in RFCs
- [RFC 3161](https://www.rfc-editor.org/rfc/rfc3161) — Internet X.509 PKI Time-Stamp Protocol
- [EXIT_SPEC v1.1](../cellar-door-exit/specs/EXIT_SPEC_v1.1.md) — EXIT Protocol Specification
- [W3C Verifiable Credentials Data Model 2.0](https://www.w3.org/TR/vc-data-model-2.0/)
- [W3C DID Core](https://www.w3.org/TR/did-core/)
- [JSON-LD 1.1](https://www.w3.org/TR/json-ld11/)

---

*𓉸 "Departure is a right. Admission is a privilege. Together they make Passage."*

*Right of Passage — there's always a door...*
