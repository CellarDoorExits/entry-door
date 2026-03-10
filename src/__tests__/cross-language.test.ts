import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { canonicalize, computeArrivalId, verifyArrivalMarker } from "../index.js";

const vectors = JSON.parse(
  readFileSync(resolve(__dirname, "../../test-vectors.json"), "utf-8")
);

describe("cross-language test vectors", () => {
  describe("canonicalization", () => {
    for (const vec of vectors.canonicalization) {
      it(vec.description, () => {
        expect(canonicalize(vec.input)).toBe(vec.expected);
      });
    }
  });

  describe("arrival marker content hashing", () => {
    for (const [alg, data] of Object.entries(vectors.arrivalMarkers) as any[]) {
      it(`${alg}: computeArrivalId matches vector`, () => {
        expect(computeArrivalId(data.unsigned)).toBe(data.contentHash);
      });

      it(`${alg}: canonicalized form matches vector`, () => {
        expect(canonicalize(data.unsigned)).toBe(data.canonicalized);
      });
    }
  });

  describe("signature verification", () => {
    for (const [alg, data] of Object.entries(vectors.arrivalMarkers) as any[]) {
      it(`${alg}: signed marker verifies`, () => {
        const result = verifyArrivalMarker(data.signed);
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
      });
    }
  });
});
