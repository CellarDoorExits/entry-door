# cellar-door-entry

**Verifiable arrival markers** — the authenticated declaration of arrival that completes identity continuity across contexts.

The counterpart to [`cellar-door-exit`](../cellar-door-exit). Together they form the complete Cellar Door: *there's always a door, and it swings both ways.*

## Install

```bash
npm install cellar-door-entry cellar-door-exit
```

## Quick Start

```typescript
import { quickExit, toJSON } from "cellar-door-exit";
import { quickEntry } from "cellar-door-entry";

// Agent exits Platform A
const { marker: exitMarker } = quickExit("https://platform-a.example.com");
const exitJson = toJSON(exitMarker);

// Agent arrives at Platform B
const { arrivalMarker, continuity } = quickEntry(exitJson, "https://platform-b.example.com");

console.log(continuity.valid);           // true
console.log(arrivalMarker.departureRef); // urn:exit:...
console.log(arrivalMarker.subject);      // did:key:z6Mk...
```

## The Transfer Flow

The complete pipeline for agent transfer between platforms:

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
const { marker: exitMarker } = quickExit("https://platform-a.example.com");

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

// 6. Verify the full transfer
const transfer = verifyTransfer(exitMarker, signed);
console.log(transfer.verified); // true

// 7. Validate marker structure
const valid = validateArrivalMarker(signed);
console.log(valid.valid); // true
```

## Modules

### Admission Policy

Composable rules for deciding whether to admit an arriving agent.

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
  blockedOrigins: ["https://bad.example.com"],
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

Prevent replay attacks — each EXIT marker can only be claimed once.

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

### Transfer Verification

End-to-end verification of the EXIT → ENTRY chain.

```typescript
import { verifyTransfer } from "cellar-door-entry";

const record = verifyTransfer(exitMarker, signedArrival);
// → { verified: boolean, errors: [], transferTime: 1234, continuity: {...} }
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
| `verifyTransfer(exit, arrival)` | Full end-to-end transfer verification |
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
