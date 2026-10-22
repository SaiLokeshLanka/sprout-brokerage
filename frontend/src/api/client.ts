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
    let message = 'Request failed';
    try {
      const data = await res.json();
      message = (Array.isArray(data.message) ? data.message[0] : data.message) ?? message;
    } catch {
      // non-JSON error body
    }
    if (res.status >= 500) message = 'Something went wrong on our side. Please try again.';
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>('GET', path, undefined, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('POST', path, body, options),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('PATCH', path, body, options),
};

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong');
