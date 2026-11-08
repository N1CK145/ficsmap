import type { ApiError, ApiErrorCode } from '../../shared/api.js';

/** `network`: the request never got a response (offline, DNS, aborted). */
export type ApiClientErrorCode = ApiErrorCode | 'network';

export class ApiClientError extends Error {
  constructor(readonly status: number, readonly code: ApiClientErrorCode, message: string) {
    super(message);
    this.name = 'ApiClientError';
  }
}

const KNOWN_CODES: ReadonlySet<string> = new Set(Object.keys({
  unauthorized: true, forbidden: true, not_found: true, invalid_body: true,
  invalid_origin: true, rate_limited: true, invite_invalid: true, limit_reached: true, internal: true,
} satisfies Record<ApiErrorCode, true>));

/** The server rejects a mutation without a JSON content type, so these always send a body. */
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

/**
 * JSON request against the own server. Throws ApiClientError for every non-2xx answer.
 * On 401 the browser goes to /login (and comes back to the current page after sign-in).
 */
export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const verb = method.toUpperCase();
  const payload = body === undefined && BODY_METHODS.has(verb) ? {} : body;
  return payload === undefined
    ? request<T>(verb, path)
    : request<T>(verb, path, JSON.stringify(payload), { 'content-type': 'application/json' });
}

/**
 * Like `api`, with a body that is already encoded (e.g. gzip-compressed JSON) and its own headers. A mutation still
 * needs `content-type: application/json` (the server's CSRF check), so the caller sets it.
 */
export async function apiSend<T>(method: string, path: string, body: BodyInit, headers: Record<string, string>): Promise<T> {
  return request<T>(method.toUpperCase(), path, body, headers);
}

async function request<T>(method: string, path: string, body?: BodyInit, extraHeaders: Record<string, string> = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json', ...extraHeaders };
  const init: RequestInit = { method, credentials: 'same-origin', headers };
  if (body !== undefined) init.body = body;

  let res: Response;
  try {
    res = await fetch(path, init);
  } catch (err) {
    throw new ApiClientError(0, 'network', err instanceof Error ? err.message : String(err));
  }
  if (res.status === 401) redirectToLogin();
  if (!res.ok) throw await toError(res);
  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiClientError(res.status, 'internal', 'Response is not JSON');
  }
}

function redirectToLogin(): void {
  const { pathname, search } = window.location;
  if (pathname === '/login') return;
  window.location.assign(`/login?returnTo=${encodeURIComponent(pathname + search)}`);
}

async function toError(res: Response): Promise<ApiClientError> {
  const fallback = res.statusText || `HTTP ${res.status}`;
  try {
    const b = (await res.json()) as Partial<ApiError>;
    if (typeof b.error === 'string' && KNOWN_CODES.has(b.error)) {
      return new ApiClientError(res.status, b.error, typeof b.message === 'string' ? b.message : fallback);
    }
  } catch {
    // Not JSON (proxy error page etc.).
  }
  return new ApiClientError(res.status, 'internal', fallback);
}
