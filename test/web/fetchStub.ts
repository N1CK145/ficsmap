/** One request the code under test made through `fetch`. */
export interface StubCall { method: string; path: string; body: unknown }
export interface StubReply { status?: number; body?: unknown }
export type StubRoute = StubReply | ((call: StubCall) => StubReply | Promise<StubReply>);

/**
 * Replaces `fetch` with a stub answering from `routes`, keyed by "METHOD /path" (with or without the
 * query string). Unknown requests get a 404 in the server's error shape. Undo with vi.unstubAllGlobals().
 */
export function stubFetch(routes: Record<string, StubRoute>) {
  const calls: StubCall[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const url = new URL(String(input), 'http://localhost');
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    const call: StubCall = { method, path: url.pathname + url.search, body };
    calls.push(call);
    const route = routes[`${method} ${call.path}`] ?? routes[`${method} ${url.pathname}`];
    const reply: StubReply = route === undefined
      ? { status: 404, body: { error: 'not_found', message: `no stub for ${method} ${call.path}` } }
      : typeof route === 'function' ? await route(call) : route;
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fn);
  return { calls, fn };
}
