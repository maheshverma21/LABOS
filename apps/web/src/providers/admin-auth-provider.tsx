"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import type { AdminAuthResponse, AdminMfaChallenge, AdminSessionUser, LoginInput } from "@lms/shared";
import { adminApi, refreshAdminSession, setAdminExpiredHandler, setAdminToken } from "@/lib/admin-api";

type Status = "loading" | "authenticated" | "unauthenticated";

interface AdminAuthValue {
  status: Status;
  admin: AdminSessionUser | null;
  isSuper: boolean;
  /** Resolves to a ticket when an authenticator code is needed next. */
  login: (input: LoginInput) => Promise<{ mfaToken: string } | null>;
  verifyCode: (mfaToken: string, code: string) => Promise<void>;
  /** Re-reads the signed-in admin (e.g. after turning on two-step). */
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AdminAuthContext = createContext<AdminAuthValue | null>(null);

export function AdminAuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Status>("loading");
  const [admin, setAdmin] = useState<AdminSessionUser | null>(null);
  const [expiresIn, setExpiresIn] = useState(900);

  const apply = useCallback((data: AdminAuthResponse | null) => {
    setAdminToken(data?.accessToken ?? null);
    setAdmin(data?.admin ?? null);
    if (data) setExpiresIn(data.expiresIn);
    setStatus(data ? "authenticated" : "unauthenticated");
  }, []);

  // Resume the session; if the server can't be reached, keep trying instead of signing out.
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const attempt = () =>
      refreshAdminSession()
        .then((data) => {
          if (!cancelled) apply(data);
        })
        .catch(() => {
          if (!cancelled) timer = window.setTimeout(attempt, 5000);
        });
    attempt();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [apply]);

  useEffect(() => {
    if (status !== "authenticated") return;
    const id = window.setInterval(() => {
      refreshAdminSession()
        .then((data) => {
          if (data) setAdmin(data.admin);
        })
        .catch(() => undefined);
    }, Math.max(30, expiresIn - 60) * 1000);
    return () => window.clearInterval(id);
  }, [status, expiresIn]);

  useEffect(() => {
    setAdminExpiredHandler(() => {
      apply(null);
      queryClient.removeQueries({ queryKey: ["admin"] });
      router.replace("/login?expired=1");
    });
    return () => setAdminExpiredHandler(null);
  }, [apply, queryClient, router]);

  const login = useCallback(
    async (input: LoginInput) => {
      const res = await adminApi<AdminAuthResponse | AdminMfaChallenge>("/auth/login", { method: "POST", body: input });
      if ("mfaToken" in res) return { mfaToken: res.mfaToken };
      apply(res);
      return null;
    },
    [apply],
  );

  const verifyCode = useCallback(
    async (mfaToken: string, code: string) => {
      apply(await adminApi<AdminAuthResponse>("/auth/mfa", { method: "POST", body: { mfaToken, code } }));
    },
    [apply],
  );

  const refresh = useCallback(async () => {
    const data = await refreshAdminSession().catch(() => null);
    if (data) apply(data);
  }, [apply]);

  const logout = useCallback(async () => {
    await adminApi("/auth/logout", { method: "POST" }).catch(() => undefined);
    apply(null);
    queryClient.removeQueries({ queryKey: ["admin"] });
    router.replace("/login");
  }, [apply, queryClient, router]);

  const value = useMemo(
    () => ({ status, admin, isSuper: admin?.role === "SUPER_ADMIN", login, verifyCode, refresh, logout }),
    [status, admin, login, verifyCode, refresh, logout],
  );
  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}

export function useAdminAuth(): AdminAuthValue {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error("useAdminAuth must be used inside <AdminAuthProvider>");
  return ctx;
}
