/**
 * cellar-door-entry — Admission Event Emitter
 *
 * Simple typed event emitter for admission lifecycle events.
 */

export type AdmissionEventType =
  | "agent:admitted"
  | "agent:quarantined"
  | "agent:rejected"
  | "agent:minted"
  | "quarantine:expired"
  | "admission:contested";

export interface AdmissionEvent {
  type: AdmissionEventType;
  timestamp: string;
  data: Record<string, unknown>;
}

type EventHandler = (event: AdmissionEvent) => void;
type ErrorHandler = (error: unknown, event: AdmissionEvent) => void;

export interface EmitterOpts {
  /** Called when a listener throws. Defaults to console.error. */
  onError?: ErrorHandler;
}

/**
 * Simple EventEmitter for admission events.
 */
export class AdmissionEventEmitter {
  private handlers = new Map<AdmissionEventType, EventHandler[]>();
  private allHandlers: EventHandler[] = [];
  private errorHandler: ErrorHandler;

  constructor(opts?: EmitterOpts) {
    this.errorHandler = opts?.onError ?? ((err, event) => {
      console.error(`AdmissionEventEmitter: handler error for ${event.type}:`, err);
    });
  }

  on(type: AdmissionEventType, handler: EventHandler): this {
    const list = this.handlers.get(type) ?? [];
    list.push(handler);
    this.handlers.set(type, list);
    return this;
  }

  onAny(handler: EventHandler): this {
    this.allHandlers.push(handler);
    return this;
  }

  off(type: AdmissionEventType, handler: EventHandler): this {
    const list = this.handlers.get(type);
    if (list) {
      this.handlers.set(type, list.filter((h) => h !== handler));
    }
    return this;
  }

  offAny(handler: EventHandler): this {
    this.allHandlers = this.allHandlers.filter((h) => h !== handler);
    return this;
  }

  emit(type: AdmissionEventType, data: Record<string, unknown> = {}): void {
    const event: AdmissionEvent = {
      type,
      timestamp: new Date().toISOString(),
      data,
    };
    const list = this.handlers.get(type) ?? [];
    for (const handler of list) {
      try { handler(event); } catch (err) { this.errorHandler(err, event); }
    }
    for (const handler of this.allHandlers) {
      try { handler(event); } catch (err) { this.errorHandler(err, event); }
    }
  }

  removeAllListeners(): void {
    this.handlers.clear();
    this.allHandlers = [];
  }

  listenerCount(type: AdmissionEventType): number {
    return (this.handlers.get(type) ?? []).length;
  }
}
