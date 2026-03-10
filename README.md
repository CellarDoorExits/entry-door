# cellar-door-entry

[![npm version](https://img.shields.io/npm/v/cellar-door-entry)](https://www.npmjs.com/package/cellar-door-entry)
[![tests](https://img.shields.io/badge/tests-262_passing-brightgreen)]()
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)
[![NIST](https://img.shields.io/badge/NIST-submitted-orange)](https://cellar-door.dev/nist/)

> **[𓉸 Passage Protocol](https://cellar-door.dev)** · [exit-door](https://github.com/CellarDoorExits/exit-door) · [entry-door](https://github.com/CellarDoorExits/entry-door) · [mcp](https://github.com/CellarDoorExits/mcp-server) · [langchain](https://github.com/CellarDoorExits/langchain) · [vercel](https://github.com/CellarDoorExits/vercel-ai-sdk) · [eliza](https://github.com/CellarDoorExits/eliza-exit) · [eas](https://github.com/CellarDoorExits/eas-adapter) · [erc-8004](https://github.com/CellarDoorExits/erc-8004-adapter) · [sign](https://github.com/CellarDoorExits/sign-protocol-adapter) · [python](https://github.com/CellarDoorExits/exit-python)

> **⚠️ Pre-release software — no formal security audit has been conducted.** This project is published for transparency, review, and community feedback. It should not be used in production systems where security guarantees are required. If you find a vulnerability, please report it to hawthornhollows@gmail.com.

The arrival side. Verify where an agent came from and decide whether to let it in.

> 📌 **[v1.2 Stable Snapshot](https://github.com/CellarDoorExits/entry-door/tree/v1.2-snapshot)** — Tagged reference point before v2 policy engine changes.

## Ecosystem

| Package | Language | Description |
|---------|----------|-------------|
| [cellar-door-exit](https://github.com/CellarDoorExits/exit-door) | TypeScript | Core protocol (reference impl) |
| [cellar-door-exit](https://github.com/CellarDoorExits/exit-python) | Python | Core protocol |
| **[cellar-door-entry](https://github.com/CellarDoorExits/entry-door)** | **TypeScript** | **Arrival/entry markers ← you are here** |
| [@cellar-door/langchain](https://github.com/CellarDoorExits/langchain) | TypeScript | LangChain integration |
| [cellar-door-langchain](https://github.com/CellarDoorExits/cellar-door-langchain-python) | Python | LangChain integration |
| [@cellar-door/vercel-ai-sdk](https://github.com/CellarDoorExits/vercel-ai-sdk) | TypeScript | Vercel AI SDK |
| [@cellar-door/mcp-server](https://github.com/CellarDoorExits/mcp-server) | TypeScript | MCP server |
| [@cellar-door/eliza](https://github.com/CellarDoorExits/eliza-exit) | TypeScript | ElizaOS plugin |
| [@cellar-door/eas](https://github.com/CellarDoorExits/eas-adapter) | TypeScript | EAS attestation anchoring |
| [@cellar-door/erc-8004](https://github.com/CellarDoorExits/erc-8004-adapter) | TypeScript | ERC-8004 identity/reputation |
| [@cellar-door/sign-protocol](https://github.com/CellarDoorExits/sign-protocol-adapter) | TypeScript | Sign Protocol attestation |

**[Paper](https://cellar-door.dev/paper/) · [Website](https://cellar-door.dev)**

## Quick Start

```bash
npm install cellar-door-entry cellar-door-exit
```

```typescript
import { quickExit, toJSON } from "cellar-door-exit";
import { quickEntry } from "cellar-door-entry";

// Agent exits Platform A
const { marker: exitMarker } = await quickExit("https://platform-a.example.com");
const exitJson = toJSON(exitMarker);

// Agent arrives at Platform B
const { arrivalMarker, continuity } = quickEntry(exitJson, "https://platform-b.example.com");

console.log(continuity.valid);           // true
console.log(arrivalMarker.departureRef); // urn:exit:...
console.log(arrivalMarker.subject);      // did:key:z6Mk...
```

## The Passage Flow

The complete pipeline for agent passage between platforms:

```
EXIT → verify departure → evaluate admission → create arrival → sign → verify continuity → claim
```

```typescript
import { quickExit, toJSON, generateIdentity } from "cellar-door-exit";
import {
  createArrivalMarker,
  signArrivalMarker,
  evaluateAdmission,
  OPEN_DOOR,
  scopeFromExitMarker,
  InMemoryClaimStore,
  verifyTransfer,
  validateArrivalMarker,
} from "cellar-door-entry";

// 1. Agent exits Platform A
const { marker: exitMarker } = await quickExit("https://platform-a.example.com");

// 2. Evaluate admission policy
const admission = evaluateAdmission(exitMarker, OPEN_DOOR);
if (!admission.admitted) throw new Error(`Denied: ${admission.reasons.join(", ")}`);

// 3. Derive capability scope from exit modules
const scope = scopeFromExitMarker(exitMarker);

// 4. Create and sign arrival marker
const arrival = createArrivalMarker(exitMarker, "https://platform-b.example.com", {
  capabilityScope: scope,
});
const dest = generateIdentity();
const signed = signArrivalMarker(arrival, dest.privateKey, dest.publicKey);

// 5. Claim the departure (prevent replay)
const store = new InMemoryClaimStore();
store.claim(exitMarker.id, signed.id);

// 6. Verify the full passage
const passage = verifyTransfer(exitMarker, signed);
console.log(passage.verified); // true

// 7. Validate marker structure
const valid = validateArrivalMarker(signed);
console.log(valid.valid); // true
```

## Policy Engine (v2)

Composable, fail-closed policy engine for admission decisions. Cryptographic signature verification is built into the ceremony.

```typescript
import { createPolicy, admit, CAUTIOUS, REQUIRE_MUTUAL } from "cellar-door-entry";
import { quickExit, generateKeyPair } from "cellar-door-exit";

// Build a policy with the fluent API
const policy = createPolicy("my-platform")
  .requireVerifiedDeparture()      // cryptographic proof required
  .onSelfOnly("probation")         // self-attestation gets probation
  .maxAge("24h")                   // reject stale markers
  .allowMinting({ requireJustification: true })  // fresh agents OK
  .build();

// Admit an arriving agent
const { marker } = await quickExit("https://origin.example.com");
const platformKeys = generateKeyPair();
const result = await admit(marker, {
  policy,
  platformIdentity: platformKeys,   // enables counter-signing
  destination: "https://my-platform.example.com",
});

if (result.admission.admitted) {
  console.log(result.arrivalMarker.id);              // urn:entry:...
  console.log(result.admission.counterSigned);        // true
  console.log(result.admission.policyApplied);        // "my-platform"
  console.log(result.counterSignedExitMarker);        // exit marker with platform's counter-signature
}
```

### Preset Policies

| Preset | Description |
|--------|-------------|
| `CAUTIOUS` | Require verified departure, probation for self-only |
| `REQUIRE_MUTUAL` | Require counter-signed (mutual) markers |
| `REQUIRE_MUTUAL_WITH_ONRAMP` | Mutual required OR minting allowed (antitrust-safe) |
| `PERMISSIVE` | Accept most markers, probation for unverified |
| `LOCKDOWN` | Reject everything |

### Minting

Create arrival records for agents with no departure history:

```typescript
import { mintAgent, bulkMint, createPolicy } from "cellar-door-entry";

const policy = createPolicy("onboarding")
  .allowMinting({ requireJustification: true })
  .build();

// Single mint
const result = await mintAgent({
  subjectDid: "did:key:z6MkNewAgent",
  justification: "Platform bootstrap",
  policy,
});

// Bulk migration
const bulk = await bulkMint(
  [{ subjectDid: "did:key:z6Mk1", justification: "Migration" }],
  { policy }
);
```

### Events

```typescript
import { AdmissionEventEmitter } from "cellar-door-entry";

const emitter = new AdmissionEventEmitter({
  onError: (err, event) => auditLog.error(event.type, err),
});

emitter.on("agent:admitted", ({ record }) => { /* audit */ });
emitter.on("agent:rejected", ({ record }) => { /* alert */ });
emitter.on("agent:quarantined", ({ record }) => { /* review queue */ });
emitter.on("agent:minted", ({ record }) => { /* onboarding */ });

await admit(marker, { policy, emitter });
```

### SQLite Claim Store

Production-ready claim tracking with WAL mode and GDPR erasure:

```typescript
import { SqliteClaimStore } from "cellar-door-entry";

const store = new SqliteClaimStore("./claims.db");
await admit(marker, { policy, store });

// GDPR: erase all records for a subject
await store.eraseSubject("did:key:z6MkAgent");

// Stats
const stats = await store.stats();
```

## Modules (v1)

### Simple Admission Policy

Declarative rules for basic admission decisions.

```typescript
import { evaluateAdmission, OPEN_DOOR, STRICT, EMERGENCY_ONLY } from "cellar-door-entry";
import type { AdmissionPolicy } from "cellar-door-entry";

// Preset policies
evaluateAdmission(exitMarker, OPEN_DOOR);       // Accept if signed
evaluateAdmission(exitMarker, STRICT);           // Voluntary, <24h, modules required
evaluateAdmission(exitMarker, EMERGENCY_ONLY);   // Only emergency exits

// Custom policy
const policy: AdmissionPolicy = {
  requireVerifiedDeparture: true,
  maxDepartureAge: 3_600_000,          // 1 hour
  allowedExitTypes: ["voluntary"],
  requiredModules: ["lineage"],
};
const result = evaluateAdmission(exitMarker, policy);
// → { admitted: boolean, conditions: string[], reasons: string[] }
```

### Probation

Track probationary status on arrival markers.

```typescript
import { createProbationaryArrival, isProbationComplete } from "cellar-door-entry";

const arrival = createProbationaryArrival(exitMarker, "https://platform-b.example.com", {
  duration: 30 * 86_400_000,  // 30 days
  restrictions: ["no-api-write", "limited-storage"],
  reviewRequired: true,
});

// Check later
isProbationComplete(arrival);                          // false (too early)
isProbationComplete(arrival, new Date("2026-04-01"));  // true (30+ days later)
```

### Capability Scope

Determine what the arriving agent can do.

```typescript
import { scopeFromExitMarker, createRestrictedScope, mergeScopes } from "cellar-door-entry";

// Derive from EXIT marker modules
const scope = scopeFromExitMarker(exitMarker);
// → { allowed: ["basic-interaction", "identity-continuity", ...], denied: [] }

// Manual restriction
const restricted = createRestrictedScope(["read"], ["write"], "2026-12-31T00:00:00Z");

// Merge (denied wins)
const merged = mergeScopes(scope, restricted);
```

### Claim Tracking

Prevent replay attacks; each EXIT marker can only be claimed once.

```typescript
import { InMemoryClaimStore } from "cellar-door-entry";

const store = new InMemoryClaimStore();
store.claim("urn:exit:abc", "urn:entry:xyz");  // true (claimed)
store.claim("urn:exit:abc", "urn:entry:new");  // false (already claimed)
store.isClaimed("urn:exit:abc");               // true
store.revoke("urn:entry:xyz");                 // unclaims the exit
```

Implement the `ClaimStore` interface for production backends (Redis, DB, ledger).

### Revocation

Revoke arrivals after the fact.

```typescript
import { createRevocationMarker, verifyRevocationMarker, isRevoked } from "cellar-door-entry";

const revocation = createRevocationMarker(signedArrival, "fraud detected", privateKey, publicKey);
verifyRevocationMarker(revocation);           // { valid: true, errors: [] }
isRevoked(signedArrival.id, [revocation]);    // true
```

### Passage Verification

End-to-end verification of the EXIT → ENTRY chain.

> **Note:** The API currently exports `verifyTransfer()`. This will be renamed to `verifyPassage()` in v0.2.0.

```typescript
import { verifyTransfer } from "cellar-door-entry";

const record = verifyTransfer(exitMarker, signedArrival);
// → { verified: boolean, errors: [], passageTime: 1234, continuity: {...} }
```

### Input Validation

Validate arrival marker structure and fields.

```typescript
import { validateArrivalMarker } from "cellar-door-entry";

const result = validateArrivalMarker(marker);
// Checks: context, id format, DID format, timestamp, size limits, etc.
```

## API Reference

| Function | Description |
|----------|-------------|
| `verifyDeparture(exitMarker)` | Verify an EXIT marker, return structured result |
| `verifyDepartureJSON(json)` | Parse and verify an EXIT marker from JSON |
| `createArrivalMarker(exit, destination, opts?)` | Create a linked arrival marker |
| `signArrivalMarker(marker, privateKey, publicKey)` | Sign an arrival marker with Ed25519 |
| `verifyArrivalMarker(marker)` | Verify an arrival marker's signature |
| `verifyContinuity(exit, arrival)` | Verify the link between departure and arrival |
| `quickEntry(exitJson, destination, opts?)` | One-shot: parse, verify, create, sign, check continuity |
| `evaluateAdmission(exitMarker, policy, now?)` | Evaluate admission against a policy |
| `createProbationaryArrival(exit, dest, config, opts?)` | Create arrival with probation |
| `isProbationComplete(arrival, now?)` | Check if probation has elapsed |
| `scopeFromExitMarker(marker)` | Extract capabilities from EXIT modules |
| `createRestrictedScope(allowed, denied, expires?)` | Create a capability scope |
| `mergeScopes(a, b)` | Merge two scopes (denied wins) |
| `InMemoryClaimStore` | In-memory claim tracking |
| `createRevocationMarker(arrival, reason, privKey, pubKey)` | Create a signed revocation |
| `verifyRevocationMarker(marker)` | Verify revocation signature |
| `isRevoked(arrivalId, revocations)` | Check if an arrival is revoked |
| `verifyTransfer(exit, arrival)` | Full end-to-end passage verification |
| `validateArrivalMarker(marker)` | Validate marker structure and fields |

## Continuity Checks

`verifyContinuity` validates:

- **Reference**: Arrival's `departureRef` matches the EXIT marker's `id`
- **Subject**: Same DID on both markers
- **Origin**: Arrival's `departureOrigin` matches EXIT's `origin`
- **Temporal**: Arrival timestamp is after departure timestamp
- **Cryptographic**: EXIT marker signature is valid

## License

Apache-2.0
