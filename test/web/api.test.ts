import { api, ApiClientError } from '../../src/web/app/api.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('api', () => {
  const fetchMock = vi.fn<typeof fetch>();
  const assign = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    assign.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('location', { ...window.location, pathname: '/w/abc', search: '?x=1', assign });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('GETs JSON with same-origin credentials and no body', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { id: 1 }));
    await expect(api('GET', '/api/me')).resolves.toEqual({ id: 1 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/me');
    expect(init).toMatchObject({ method: 'GET', credentials: 'same-origin' });
    expect(init?.body).toBeUndefined();
    expect(new Headers(init?.headers).has('content-type')).toBe(false);
  });

  it('sends a JSON body with the JSON content type', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { id: 'w' }));
    await api('POST', '/api/worlds', { name: 'Home' });
    const init = fetchMock.mock.calls[0]![1];
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
    expect(init?.body).toBe('{"name":"Home"}');
  });

  it('sends {} for a POST without a body, so the server accepts it', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api('POST', '/auth/logout')).resolves.toBeUndefined();
    const init = fetchMock.mock.calls[0]![1];
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
    expect(init?.body).toBe('{}');
  });

  it('sends a body-less DELETE without a content type', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await api('DELETE', '/api/worlds/w');
    const init = fetchMock.mock.calls[0]![1];
    expect(init?.body).toBeUndefined();
    expect(new Headers(init?.headers).has('content-type')).toBe(false);
  });

  it('throws ApiClientError with the server error code and message', async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, { error: 'forbidden', message: 'Owner only' }));
    const err = await api('PATCH', '/api/worlds/w', { name: 'x' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect(err).toMatchObject({ status: 403, code: 'forbidden', message: 'Owner only' });
    expect(assign).not.toHaveBeenCalled();
  });

  it('maps a non-JSON error response to internal', async () => {
    fetchMock.mockResolvedValue(new Response('Bad Gateway', { status: 502 }));
    await expect(api('GET', '/api/me')).rejects.toMatchObject({ status: 502, code: 'internal' });
  });

  it('throws internal for a 2xx answer that is not JSON', async () => {
    fetchMock.mockResolvedValue(new Response('<html>proxy</html>', { status: 200 }));
    await expect(api('GET', '/api/me')).rejects.toMatchObject({ status: 200, code: 'internal' });
  });

  it('maps a network failure to status 0 and code network', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(api('GET', '/api/me')).rejects.toMatchObject({ status: 0, code: 'network' });
  });

  it('sends the user to /login with the current path on 401', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'unauthorized', message: 'Not logged in' }));
    await expect(api('GET', '/api/me')).rejects.toMatchObject({ status: 401, code: 'unauthorized' });
    expect(assign).toHaveBeenCalledWith(`/login?returnTo=${encodeURIComponent('/w/abc?x=1')}`);
  });

  it('does not redirect on 401 while already on /login', async () => {
    vi.stubGlobal('location', { ...window.location, pathname: '/login', search: '', assign });
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'unauthorized', message: 'Not logged in' }));
    await expect(api('GET', '/api/me')).rejects.toBeInstanceOf(ApiClientError);
    expect(assign).not.toHaveBeenCalled();
  });
});
