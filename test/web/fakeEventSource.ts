import type { SseEvent } from '../../src/shared/sse.js';

/** Minimal EventSource: tests drive open, error and named events by hand. */
export class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readyState = FakeEventSource.CONNECTING;
  onopen: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  private listeners = new Map<string, ((e: MessageEvent) => void)[]>();
  closed = false;
  constructor(readonly url: string) { FakeEventSource.instances.push(this); }
  addEventListener(type: string, l: (e: MessageEvent) => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), l]); }
  close() { this.closed = true; this.readyState = FakeEventSource.CLOSED; }
  open() { this.readyState = FakeEventSource.OPEN; this.onopen?.(new Event('open')); }
  fail(state: number) { this.readyState = state; this.onerror?.(new Event('error')); }
  emit(e: SseEvent) { for (const l of this.listeners.get(e.type) ?? []) l(new MessageEvent(e.type, { data: JSON.stringify(e) })); }
  static last() { return FakeEventSource.instances.at(-1)!; }
}
