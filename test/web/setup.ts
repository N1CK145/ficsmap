import '@testing-library/jest-dom/vitest';

// React Router's data routers build a fetch `Request` with an AbortSignal for every navigation.
// In jsdom the signal comes from jsdom while `Request` is Node's (undici), which rejects it.
// Tests drop the signal; nothing in them aborts navigations.
const NodeRequest = globalThis.Request;
globalThis.Request = class extends NodeRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(input, init && { ...init, signal: undefined });
  }
};

// jsdom has no canvas and logs "Not implemented" for getContext. Drawing code (the map's marker
// layer) handles a null context, which is what tests get instead.
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
