import type { ApiError as ApiErrorBody, AuthResponse } from "@lms/shared";

/** Error thrown for any non-2xx API response. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string[]>,
    /** Extra data for specific errors, e.g. duplicate candidates. */
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// The access token lives only in memory. The refresh token is an httpOnly
// cookie the browser sends to /api/auth/* automatically.
let accessToken: string | null = null;
let branchId: string | null = null;
let refreshing: Promise<AuthResponse | null> | null = null;
let onSessionExpired: (() => void) | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

/** The branch the user is working at; sent so the API records it (e.g. on registrations). */
export function setBranchId(id: string | null) {
  branchId = id;
}

/** Called when a refresh fails mid-session, so the app can send the user to /login. */
export function setSessionExpiredHandler(handler: (() => void) | null) {
  onSessionExpired = handler;
}

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (body as ApiErrorBody | null)?.error;
    throw new ApiError(
      res.status,
      err?.code ?? "unknown",
      err?.message ?? `Request failed (${res.status})`,
      err?.fields,
      err?.details,
    );
  }
  return body as T;
}

/** The server couldn't be reached (no network, or it's restarting). Not the same as being signed out. */
export class OfflineError extends Error {
  constructor() {
    super("Can't reach the server. Check your connection; we'll keep trying.");
    this.name = "OfflineError";
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * POSTs to a refresh endpoint. A clear "no" from the server (401) is null:
 * signed out. No network, or the server restarting (5xx), is retried a few
 * times and then thrown as OfflineError, so a dropped connection never signs anyone out.
 */
export async function tryRefresh<T>(url: string): Promise<T | null> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { method: "POST", credentials: "same-origin" });
    } catch {
      if (attempt >= 3) throw new OfflineError();
      await wait(500 * 2 ** attempt);
      continue;
    }
    if (res.ok) return (await res.json()) as T;
    if (res.status >= 500) {
      if (attempt >= 3) throw new OfflineError();
      await wait(500 * 2 ** attempt);
      continue;
    }
    return null;
  }
}

/**
 * Exchanges the refresh cookie for a new access token. Concurrent callers
 * share one request, so a burst of 401s triggers a single refresh.
 * Resolves to null when signed out; rejects with OfflineError when the server can't be reached.
 */
export function refreshSession(): Promise<AuthResponse | null> {
  refreshing ??= tryRefresh<AuthResponse>("/api/auth/refresh")
    .then((data) => {
      setAccessToken(data?.accessToken ?? null);
      return data;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
/** A JSON body, or a file sent as-is (e.g. an image upload). */
type RequestOptions = { method?: Method; body?: unknown; file?: Blob };

/** Sends a request with the access token, refreshing it once if it has expired. */
async function request(path: string, options: RequestOptions = {}): Promise<Response> {
  const send = () =>
    fetch(`/api${path}`, {
      method: options.method ?? "GET",
      credentials: "same-origin",
      headers: {
        ...(options.file ? { "content-type": options.file.type } : options.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        ...(branchId ? { "x-branch-id": branchId } : {}),
      },
      body: options.file ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
    });

  const res = await send();

  // Access token expired: refresh once and retry.
  if (res.status === 401 && !path.startsWith("/auth/")) {
    let refreshed: AuthResponse | null;
    try {
      refreshed = await refreshSession();
    } catch (err) {
      // Offline: keep the session, just fail this request.
      if (err instanceof OfflineError) throw new ApiError(0, "offline", err.message);
      throw err;
    }
    if (!refreshed) {
      onSessionExpired?.();
      return res;
    }
    return send();
  }
  return res;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return parse<T>(await request(path, options));
}

/** Uploads a file as the request body (PUT by default). */
export async function apiUpload<T>(path: string, file: Blob, method: Method = "PUT"): Promise<T> {
  return parse<T>(await request(path, { method, file }));
}

/** Downloads a file (e.g. a PDF) the API only gives to signed-in users. */
export async function apiBlob(path: string, options: RequestOptions = {}): Promise<Blob> {
  const res = await request(path, options);
  if (!res.ok) await parse(res);
  return res.blob();
}
