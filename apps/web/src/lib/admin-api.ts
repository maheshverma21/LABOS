import type { AdminAuthResponse, ApiError as ApiErrorBody } from "@lms/shared";
import { ApiError, OfflineError, tryRefresh } from "./api";

// The platform admin console has its own token, kept apart from the lab app's,
// so being signed in to one never signs you in to the other.
let accessToken: string | null = null;
let refreshing: Promise<AdminAuthResponse | null> | null = null;
let onExpired: (() => void) | null = null;

export function setAdminToken(token: string | null) {
  accessToken = token;
}

export function setAdminExpiredHandler(handler: (() => void) | null) {
  onExpired = handler;
}

/** Resolves to null when signed out; rejects with OfflineError when the server can't be reached. */
export function refreshAdminSession(): Promise<AdminAuthResponse | null> {
  refreshing ??= tryRefresh<AdminAuthResponse>("/api/admin/auth/refresh")
    .then((data) => {
      accessToken = data?.accessToken ?? null;
      return data;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (body as ApiErrorBody | null)?.error;
    throw new ApiError(res.status, err?.code ?? "unknown", err?.message ?? `Request failed (${res.status})`, err?.fields, err?.details);
  }
  return body as T;
}

type Method = "GET" | "POST" | "PUT" | "DELETE";

export async function adminApi<T>(path: string, options: { method?: Method; body?: unknown } = {}): Promise<T> {
  const send = () =>
    fetch(`/api/admin${path}`, {
      method: options.method ?? "GET",
      credentials: "same-origin",
      headers: {
        ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

  let res = await send();
  if (res.status === 401 && !path.startsWith("/auth/")) {
    let refreshed: AdminAuthResponse | null;
    try {
      refreshed = await refreshAdminSession();
    } catch (err) {
      if (err instanceof OfflineError) throw new ApiError(0, "offline", err.message);
      throw err;
    }
    if (!refreshed) {
      onExpired?.();
      return parse<T>(res);
    }
    res = await send();
  }
  return parse<T>(res);
}
