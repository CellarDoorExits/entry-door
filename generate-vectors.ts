/**
 * Generate cross-language test vectors for entry-door.
 */
import {
  generateIdentity,
  generateP256KeyPair,
  createMarker,
  signMarker,
  didFromPublicKey,
  didFromP256PublicKey,
  signP256,
  ExitType,
  type ExitMarker,
} from "cellar-door-exit";
import {
  createArrivalMarker,
  signArrivalMarker,
  verifyArrivalMarker,
  canonicalize,
  computeArrivalId,
} from "./src/index.js";
import { writeFileSync } from "node:fs";

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

// --- Generate keypairs ---
const ed25519 = generateIdentity();
const p256 = generateP256KeyPair();

const origin = "did:web:origin.example.com";
const destination = "did:web:destination.example.com";
const arrivalTimestamp = "2026-02-01T09:00:00.000Z";

// --- Build EXIT marker (Ed25519 only for simplicity, P-256 for second) ---
const exitEdUnsigned = createMarker({
  subject: didFromPublicKey(ed25519.publicKey),
  origin,
  exitType: "voluntary" as ExitType,
});
const exitEd = signMarker(exitEdUnsigned, ed25519.privateKey, ed25519.publicKey);

// For P-256, use the signMarkerWithSigner or just test arrival with Ed25519 exit
// Let's just create two arrival markers both from Ed25519 exit but signed differently
const arrivalEd = createArrivalMarker(exitEd, destination, {
  timestamp: arrivalTimestamp,
  admissionType: "automatic",
});

// --- Sign arrival with Ed25519 ---
const signedEd = signArrivalMarker(arrivalEd, ed25519.privateKey, ed25519.publicKey, "Ed25519");
signedEd.proof!.created = "2026-02-01T09:00:01.000Z";

// --- Sign arrival with P-256 ---
const signedP256 = signArrivalMarker(arrivalEd, p256.privateKey, p256.publicKey, "P-256");
signedP256.proof!.created = "2026-02-01T09:00:01.000Z";

// --- Verify roundtrip ---
const verEd = verifyArrivalMarker(signedEd);
if (!verEd.valid) throw new Error(`Ed25519 verify failed: ${verEd.errors}`);
const verP256 = verifyArrivalMarker(signedP256);
if (!verP256.valid) throw new Error(`P-256 verify failed: ${verP256.errors}`);

// --- Canonicalization ---
const { proof: _p1, ...edBody } = signedEd;
const edCanonical = canonicalize(edBody);
const { proof: _p2, ...p256Body } = signedP256;
const p256Canonical = canonicalize(p256Body);

const vectors = {
  _meta: {
    generator: "cellar-door-entry (TypeScript)",
    version: "0.1.2",
    generated: new Date().toISOString(),
    description: "Cross-language test vectors for ENTRY Protocol (arrival markers)",
  },
  canonicalization: [
    { description: "Simple object — keys sorted", input: { b: "2", a: "1" }, expected: '{"a":"1","b":"2"}' },
    { description: "Nested object — recursive sort", input: { z: { b: 2, a: 1 }, a: "first" }, expected: '{"a":"first","z":{"a":1,"b":2}}' },
    { description: "Array values preserved in order", input: { arr: [3, 1, 2], key: "val" }, expected: '{"arr":[3,1,2],"key":"val"}' },
  ],
  keys: {
    ed25519: {
      privateKeyHex: toHex(ed25519.privateKey),
      publicKeyHex: toHex(ed25519.publicKey),
      did: signedEd.proof!.verificationMethod,
    },
    p256: {
      privateKeyHex: toHex(p256.privateKey),
      publicKeyHex: toHex(p256.publicKey),
      did: signedP256.proof!.verificationMethod,
    },
  },
  arrivalMarkers: {
    ed25519: {
      description: "Arrival marker signed with Ed25519",
      unsigned: edBody,
      canonicalized: edCanonical,
      contentHash: computeArrivalId(edBody as any),
      signed: signedEd,
    },
    p256: {
      description: "Arrival marker signed with P-256 (ECDSA)",
      unsigned: p256Body,
      canonicalized: p256Canonical,
      contentHash: computeArrivalId(p256Body as any),
      signed: signedP256,
    },
  },
};

const json = JSON.stringify(vectors, null, 2);
writeFileSync("test-vectors.json", json);
writeFileSync("../entry-door-python/tests/test-vectors.json", json);
console.log("✅ Test vectors written");
