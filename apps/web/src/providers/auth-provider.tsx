"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import type { AuthResponse, LoginInput, Permission, SessionUser, SignupInput } from "@lms/shared";
import { api, refreshSession, setAccessToken, setBranchId, setSessionExpiredHandler } from "@/lib/api";

type Status = "loading" | "authenticated" | "unauthenticated";

interface AuthContextValue {
  status: Status;
  /** Couldn't reach the server to resume the session; retrying. */
  offline: boolean;
  user: SessionUser | null;
  login: (input: LoginInput) => Promise<void>;
  signup: (input: SignupInput) => Promise<void>;
  logout: () => Promise<void>;
  can: (permission: Permission) => boolean;
  /** The branch the user is working at (remembered per browser). */
  branch: { id: string; name: string } | null;
  setBranch: (id: string) => void;
  /** Re-reads the signed-in user (e.g. after branches or roles change). */
  refreshUser: () => Promise<void>;
}

const BRANCH_KEY = "lms.branch";

function readStoredBranch(): string | null {
  try {
    return window.localStorage.getItem(BRANCH_KEY);
  } catch {
    return null;
  }
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [expiresIn, setExpiresIn] = useState(900);
  const [chosenBranchId, setChosenBranchId] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);

  const applySession = useCallback((data: AuthResponse | null) => {
    setAccessToken(data?.accessToken ?? null);
    setUser(data?.user ?? null);
    if (data) setExpiresIn(data.expiresIn);
    setStatus(data ? "authenticated" : "unauthenticated");
  }, []);

  // On first load, try to resume the session from the refresh cookie. If the
  // server can't be reached, keep trying rather than showing the sign-in page.
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const attempt = () =>
      refreshSession()
        .then((data) => {
          if (cancelled) return;
          setOffline(false);
          applySession(data);
        })
        .catch(() => {
          if (cancelled) return;
          setOffline(true);
          timer = window.setTimeout(attempt, 5000);
        });
    attempt();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [applySession]);

  // Refresh shortly before the access token expires, so requests rarely hit a 401.
  useEffect(() => {
    if (status !== "authenticated") return;
    const id = window.setInterval(
      () => {
        refreshSession()
          .then((data) => {
            if (data) setUser(data.user);
          })
          // Offline for now: the next request (or this timer) tries again.
          .catch(() => undefined);
      },
      Math.max(30, expiresIn - 60) * 1000,
    );
    return () => window.clearInterval(id);
  }, [status, expiresIn]);

  useEffect(() => {
    setSessionExpiredHandler(() => {
      applySession(null);
      queryClient.clear();
      router.replace("/login?expired=1");
    });
    return () => setSessionExpiredHandler(null);
  }, [applySession, queryClient, router]);

  const login = useCallback(
    async (input: LoginInput) => {
      applySession(await api<AuthResponse>("/auth/login", { method: "POST", body: input }));
    },
    [applySession],
  );

  const signup = useCallback(
    async (input: SignupInput) => {
      applySession(await api<AuthResponse>("/auth/signup", { method: "POST", body: input }));
    },
    [applySession],
  );

  const logout = useCallback(async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => undefined);
    applySession(null);
    queryClient.clear();
    router.replace("/login");
  }, [applySession, queryClient, router]);

  // The chosen branch if the user still has it, else their first branch.
  const branch = useMemo(() => {
    if (!user) return null;
    const wanted = chosenBranchId ?? (typeof window === "undefined" ? null : readStoredBranch());
    return user.branches.find((b) => b.id === wanted) ?? user.branches[0] ?? null;
  }, [user, chosenBranchId]);

  // Keep the API client in step before any request goes out.
  setBranchId(branch?.id ?? null);

  const setBranch = useCallback(
    (id: string) => {
      setChosenBranchId(id);
      setBranchId(id); // before the refetch below, not on the next render
      try {
        window.localStorage.setItem(BRANCH_KEY, id);
      } catch {
        // Private mode: the choice lasts until reload.
      }
      queryClient.invalidateQueries();
    },
    [queryClient],
  );

  const refreshUser = useCallback(async () => {
    const data = await refreshSession().catch(() => null);
    if (data) applySession(data);
  }, [applySession]);

  const can = useCallback((permission: Permission) => user?.permissions.includes(permission) ?? false, [user]);

  const value = useMemo(
    () => ({ status, offline, user, login, signup, logout, can, branch, setBranch, refreshUser }),
    [status, offline, user, login, signup, logout, can, branch, setBranch, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
