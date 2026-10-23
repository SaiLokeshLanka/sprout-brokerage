/**
 * Thin fetch wrapper for the Sprout API.
 *
 * - The access token lives only in memory (never localStorage), so an XSS bug can't read a stored token.
 * - The refresh token is an httpOnly cookie the browser sends automatically to /api/auth.
 * - On a 401, the client refreshes once and retries the request.
 */

export interface ApiUser {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  kycStatus: 'PENDING' | 'VERIFIED';
  panMasked: string | null;
  dateOfBirth: string | null;
  kycVerifiedAt: string | null;
  createdAt: string;
}

export interface SessionResponse {
  accessToken: string;
  user: ApiUser;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  /** Attach the access token and refresh on 401 (default true). */
  auth?: boolean;
  retry?: boolean;
  headers?: Record<string, string>;
}

let accessToken: string | null = null;
let sessionLostHandler: (() => void) | null = null;
let refreshInFlight: Promise<SessionResponse | null> | null = null;

export const setAccessToken = (token: string | null) => {
  accessToken = token;
};

/** Current in-memory access token (used to authenticate the private WebSocket). */
export const getAccessToken = () => accessToken;

/** Called when the session can't be renewed (expired, logged out elsewhere, revoked). */
export const onSessionLost = (handler: () => void) => {
  sessionLostHandler = handler;
};

/**
 * Renews the session from the refresh cookie. Refresh tokens are single-use, so
 * concurrent callers (e.g. React StrictMode's double effect) share ONE request.
 */
export function refreshSession(): Promise<SessionResponse | null> {
  refreshInFlight ??= request<SessionResponse>('POST', '/auth/refresh', undefined, { auth: false })
    .then((session) => {
      accessToken = session.accessToken;
      return session;
    })
    .catch(() => {
      accessToken = null;
      return null;
    })
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

const UNREACHABLE = "We can't reach Sprout right now. Please try again in a moment.";

/** Picks a message the user can act on. Never shows raw internals of a server error. */
function describeError(status: number, serverMessage?: string): string {
  if (status === 503) return serverMessage ?? UNREACHABLE; // server says a dependency (e.g. database) is down
  if (status === 502 || status === 504) return UNREACHABLE; // gateway/proxy couldn't reach the API
  if (status >= 500) return serverMessage ? 'Something went wrong on our side. Please try again.' : UNREACHABLE;
  return serverMessage ?? 'Request failed';
}

export async function request<T>(method: string, path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
  const { auth = true, retry = true, headers = {} } = options;

  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(auth && accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection and try again.');
  }

  if (res.status === 401 && auth && retry) {
    if (await refreshSession()) return request<T>(method, path, body, { ...options, retry: false });
    sessionLostHandler?.();
  }

  if (!res.ok) {
    let serverMessage: string | undefined;
    try {
      const data = await res.json();
      serverMessage = Array.isArray(data.message) ? data.message[0] : data.message;
    } catch {
      // empty or non-JSON body — e.g. the dev proxy couldn't reach the API at all
    }
    throw new ApiError(res.status, describeError(res.status, serverMessage));
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>('GET', path, undefined, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('POST', path, body, options),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('PATCH', path, body, options),
  delete: <T>(path: string, options?: RequestOptions) => request<T>('DELETE', path, undefined, options),
};

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong');
