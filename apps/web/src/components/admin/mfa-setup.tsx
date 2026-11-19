"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { CopyIcon, ShieldCheckIcon } from "lucide-react";
import type { AdminMfaSetup } from "@lms/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { useAdminAuth } from "@/providers/admin-auth-provider";
import { adminApi } from "@/lib/admin-api";

/**
 * Turning on two-step sign-in: scan a QR code, confirm one code, then save the
 * recovery codes (shown once).
 */
export function MfaSetup({ forced = false }: { forced?: boolean }) {
  const { refresh } = useAdminAuth();
  const [setup, setSetup] = useState<AdminMfaSetup | null>(null);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState<string[] | null>(null);

  const start = useMutation({
    mutationFn: () => adminApi<{ setup: AdminMfaSetup }>("/auth/mfa/setup", { method: "POST" }),
    onSuccess: (r) => setSetup(r.setup),
    onError: (err) => toast.error(err.message),
  });
  const enable = useMutation({
    mutationFn: () => adminApi<{ recoveryCodes: string[] }>("/auth/mfa/enable", { method: "POST", body: { code } }),
    onSuccess: (r) => setRecovery(r.recoveryCodes),
    onError: (err) => toast.error(err.message),
  });

  if (recovery) {
    return (
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheckIcon className="size-5 text-emerald-600" /> Two-step sign-in is on
          </CardTitle>
          <CardDescription>
            Save these recovery codes somewhere safe, like a password manager. Each works once, if you lose your phone. They won&apos;t be shown
            again.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/40 p-4 font-mono text-sm">
            {recovery.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(recovery.join("\n"));
                  toast.success("Copied");
                } catch {
                  toast.error("Couldn't copy. Write them down instead.");
                }
              }}
            >
              <CopyIcon /> Copy codes
            </Button>
            <Button onClick={refresh}>I&apos;ve saved them</Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheckIcon className="size-5" /> Set up two-step sign-in
        </CardTitle>
        <CardDescription>
          {forced ? "This console can see every lab's data, so a code from your phone is required as well as your password. " : ""}
          Use Google Authenticator, Microsoft Authenticator or any similar app.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {!setup ? (
          <Button onClick={() => start.mutate()} disabled={start.isPending}>
            {start.isPending && <Spinner />}
            Start setup
          </Button>
        ) : (
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              enable.mutate();
            }}
          >
            <ol className="list-decimal space-y-4 pl-5 text-sm">
              <li>
                In the app, add an account and scan this code.
                {/* eslint-disable-next-line @next/next/no-img-element -- a data URL from the API, no optimisation needed */}
                <img src={setup.qrDataUrl} alt="QR code for your authenticator app" width={180} height={180} className="mt-2 rounded border bg-white p-1" />
                <span className="mt-2 block text-xs text-muted-foreground">
                  Can&apos;t scan? Enter this key instead: <span className="font-mono break-all text-foreground">{setup.secret}</span>
                </span>
              </li>
              <li>
                <Label htmlFor="mfa-code" className="font-normal">
                  Type the 6-digit code the app shows.
                </Label>
                <Input
                  id="mfa-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  className="mt-2 w-40 text-center font-mono text-lg tracking-widest"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  autoFocus
                />
              </li>
            </ol>
            <Button type="submit" disabled={code.trim().length < 6 || enable.isPending}>
              {enable.isPending && <Spinner />}
              Turn on
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
