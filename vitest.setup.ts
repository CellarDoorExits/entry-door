// Polyfill globalThis.crypto for Node 18 (required by @noble/ed25519 v2+)
if (typeof globalThis.crypto === "undefined" || !globalThis.crypto.getRandomValues) {
  const { webcrypto } = await import("node:crypto");
  Object.defineProperty(globalThis, "crypto", { value: webcrypto });
}
