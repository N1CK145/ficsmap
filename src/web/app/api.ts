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
  invalid_origin: true, rate_limited: true, invite_invalid: true, internal: true,
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
  const headers: Record<string, string> = { accept: 'application/json' };
  const init: RequestInit = { method: verb, credentials: 'same-origin', headers };
  if (payload !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(payload);
  }

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
