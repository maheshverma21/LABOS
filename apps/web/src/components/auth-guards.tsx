"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/providers/auth-provider";

function FullPageSpinner() {
  const { offline } = useAuth();
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-3 px-4 text-center">
      <Spinner className="size-6 text-muted-foreground" />
      {offline && <p className="text-sm text-muted-foreground">Can&apos;t reach the server. Check your connection; trying again…</p>}
    </div>
  );
}

/** Renders children only for signed-in users; everyone else goes to /login. */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
  }, [status, router]);

  if (status !== "authenticated") return <FullPageSpinner />;
  return children;
}

/** For the login and signup pages: signed-in users go straight to the dashboard. */
export function RedirectIfAuthenticated({ children }: { children: React.ReactNode }) {
  const { status, user } = useAuth();
  const router = useRouter();
  // A reset link must work even if someone is signed in on this browser.
  const always = usePathname().startsWith("/reset-password");

  useEffect(() => {
    // B2B clients have their own portal; everyone else starts at the dashboard.
    if (status === "authenticated" && !always) router.replace(user?.permissions.includes("b2b:portal") ? "/portal" : "/dashboard");
  }, [status, user, router, always]);

  if (!always && status !== "unauthenticated") return <FullPageSpinner />;
  return children;
}

/** B2B clients belong in their portal: the lab app's pages send them there. */
export function StaffOnly({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const router = useRouter();
  const isClient = !!user?.permissions.includes("b2b:portal");

  useEffect(() => {
    if (isClient) router.replace("/portal");
  }, [isClient, router]);

  if (isClient) return <FullPageSpinner />;
  return children;
}
