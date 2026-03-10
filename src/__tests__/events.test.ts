import { describe, it, expect, vi } from "vitest";
import { AdmissionEventEmitter, type AdmissionEvent } from "../events.js";

describe("AdmissionEventEmitter", () => {
  it("should emit and receive events", () => {
    const emitter = new AdmissionEventEmitter();
    const handler = vi.fn();
    emitter.on("agent:admitted", handler);
    emitter.emit("agent:admitted", { test: true });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].type).toBe("agent:admitted");
    expect(handler.mock.calls[0][0].data.test).toBe(true);
  });

  it("should include timestamp in events", () => {
    const emitter = new AdmissionEventEmitter();
    let received: AdmissionEvent | null = null;
    emitter.on("agent:rejected", (e) => { received = e; });
    emitter.emit("agent:rejected");
    expect(received!.timestamp).toBeDefined();
  });

  it("should support multiple handlers per event", () => {
    const emitter = new AdmissionEventEmitter();
    const h1 = vi.fn();
    const h2 = vi.fn();
    emitter.on("agent:minted", h1);
    emitter.on("agent:minted", h2);
    emitter.emit("agent:minted");
    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
  });

  it("should not fire handlers for other event types", () => {
    const emitter = new AdmissionEventEmitter();
    const handler = vi.fn();
    emitter.on("agent:admitted", handler);
    emitter.emit("agent:rejected");
    expect(handler).not.toHaveBeenCalled();
  });

  it("should support onAny for all events", () => {
    const emitter = new AdmissionEventEmitter();
    const handler = vi.fn();
    emitter.onAny(handler);
    emitter.emit("agent:admitted");
    emitter.emit("agent:rejected");
    emitter.emit("agent:minted");
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it("should support off to remove handlers", () => {
    const emitter = new AdmissionEventEmitter();
    const handler = vi.fn();
    emitter.on("agent:admitted", handler);
    emitter.off("agent:admitted", handler);
    emitter.emit("agent:admitted");
    expect(handler).not.toHaveBeenCalled();
  });

  it("should support offAny", () => {
    const emitter = new AdmissionEventEmitter();
    const handler = vi.fn();
    emitter.onAny(handler);
    emitter.offAny(handler);
    emitter.emit("agent:admitted");
    expect(handler).not.toHaveBeenCalled();
  });

  it("should support removeAllListeners", () => {
    const emitter = new AdmissionEventEmitter();
    const h1 = vi.fn();
    const h2 = vi.fn();
    emitter.on("agent:admitted", h1);
    emitter.onAny(h2);
    emitter.removeAllListeners();
    emitter.emit("agent:admitted");
    expect(h1).not.toHaveBeenCalled();
    expect(h2).not.toHaveBeenCalled();
  });

  it("should report listenerCount", () => {
    const emitter = new AdmissionEventEmitter();
    expect(emitter.listenerCount("agent:admitted")).toBe(0);
    emitter.on("agent:admitted", () => {});
    emitter.on("agent:admitted", () => {});
    expect(emitter.listenerCount("agent:admitted")).toBe(2);
    expect(emitter.listenerCount("agent:rejected")).toBe(0);
  });

  it("should handle quarantine:expired events", () => {
    const emitter = new AdmissionEventEmitter();
    const handler = vi.fn();
    emitter.on("quarantine:expired", handler);
    emitter.emit("quarantine:expired", { recordId: "test-123" });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].data.recordId).toBe("test-123");
  });

  it("should handle admission:contested events", () => {
    const emitter = new AdmissionEventEmitter();
    const handler = vi.fn();
    emitter.on("admission:contested", handler);
    emitter.emit("admission:contested", { reason: "unfair" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("should chain on() calls", () => {
    const emitter = new AdmissionEventEmitter();
    const result = emitter.on("agent:admitted", () => {}).on("agent:rejected", () => {});
    expect(result).toBe(emitter);
  });

  it("should pass data through correctly", () => {
    const emitter = new AdmissionEventEmitter();
    const data = { subjectDid: "did:key:z6Mk...", policyName: "cautious" };
    let received: Record<string, unknown> = {};
    emitter.on("agent:quarantined", (e) => { received = e.data; });
    emitter.emit("agent:quarantined", data);
    expect(received.subjectDid).toBe("did:key:z6Mk...");
    expect(received.policyName).toBe("cautious");
  });

  it("should default data to empty object", () => {
    const emitter = new AdmissionEventEmitter();
    let received: AdmissionEvent | null = null;
    emitter.on("agent:admitted", (e) => { received = e; });
    emitter.emit("agent:admitted");
    expect(received!.data).toEqual({});
  });

  it("should isolate handler errors — typed handler", () => {
    const emitter = new AdmissionEventEmitter();
    const good = vi.fn();
    emitter.on("agent:admitted", () => { throw new Error("boom"); });
    emitter.on("agent:admitted", good);
    expect(() => emitter.emit("agent:admitted")).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
  });

  it("should isolate handler errors — onAny handler", () => {
    const emitter = new AdmissionEventEmitter();
    const good = vi.fn();
    emitter.onAny(() => { throw new Error("boom"); });
    emitter.onAny(good);
    expect(() => emitter.emit("agent:admitted")).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
  });
});
