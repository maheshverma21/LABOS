"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { AuthResponse } from "@lms/shared";
import { Spinner } from "@/components/ui/spinner";

/**
 * Landing page for a platform admin's "Login" on the Labs list. Swaps the one-time ticket
 * for a normal lab session (cookie), then goes to the lab's app with a full page load.
 */
function Exchange() {
  const ticket = useSearchParams().get("ticket");
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!ticket) {
      setError("This sign-in link is missing its ticket.");
      return;
    }
    fetch("/api/auth/ticket", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticket }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
          throw new Error(body?.error?.message ?? "Couldn't sign in to the lab.");
        }
        return (await res.json()) as AuthResponse;
      })
      .then((data) => window.location.replace(data.user.permissions.includes("b2b:portal") ? "/portal" : "/dashboard"))
      .catch((e: Error) => setError(e.message));
  }, [ticket]);

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-3 px-4 text-center">
      {error ? <p className="text-sm text-destructive">{error}</p> : <Spinner className="size-6 text-muted-foreground" />}
      {!error && <p className="text-sm text-muted-foreground">Signing you in to the lab…</p>}
    </div>
  );
}

export default function LabLoginPage() {
  return (
    <Suspense>
      <Exchange />
    </Suspense>
  );
}
