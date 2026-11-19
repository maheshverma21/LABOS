"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { LaptopIcon, SmartphoneIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/app-shell/page-header";
import { api } from "@/lib/api";
import { ChangePasswordForm } from "@/components/auth/change-password-form";
import { changeOwnPassword } from "@/components/auth/must-change-password";
import { useAuth } from "@/providers/auth-provider";

interface SessionRow {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
}

const dateFormat = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });

/** A short, readable device name from the user-agent string. */
function describeDevice(ua: string | null) {
  if (!ua) return { name: "Unknown device", mobile: false };
  const mobile = /Android|iPhone|iPad|Mobile/i.test(ua);
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
      ? "Chrome"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Android/.test(ua)
      ? "Android"
      : /iPhone|iPad/.test(ua)
        ? "iOS"
        : /Mac OS X/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return { name: os ? `${browser} on ${os}` : browser, mobile };
}

export default function SecurityPage() {
  const queryClient = useQueryClient();
  const { refreshUser } = useAuth();
  const { data, isPending } = useQuery({
    queryKey: ["sessions"],
    queryFn: () => api<{ sessions: SessionRow[] }>("/auth/sessions"),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api(`/auth/sessions/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Device signed out");
      return queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <>
      <PageHeader title="Security" description="Your password and the devices signed in to your account." />

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>Forgotten it? Sign out and use “Forgot password?” on the sign-in page.</CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm
            submit={changeOwnPassword}
            onDone={async () => {
              toast.success("Password changed. Other devices have been signed out.");
              await refreshUser();
              await queryClient.invalidateQueries({ queryKey: ["sessions"] });
            }}
          />
        </CardContent>
      </Card>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Active devices</CardTitle>
          <CardDescription>Sign out any device you don&apos;t recognise.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          {isPending && <Skeleton className="h-12 w-full" />}
          {data?.sessions.map((s) => {
            const device = describeDevice(s.userAgent);
            const Icon = device.mobile ? SmartphoneIcon : LaptopIcon;
            return (
              <div key={s.id} className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
                <Icon className="size-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {device.name}
                    {s.current && <Badge variant="secondary">This device</Badge>}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    Last active {dateFormat.format(new Date(s.lastUsedAt))}
                    {s.ip && ` · ${s.ip}`}
                  </div>
                </div>
                {!s.current && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={revoke.isPending && revoke.variables === s.id}
                    onClick={() => revoke.mutate(s.id)}
                  >
                    Sign out
                  </Button>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </>
  );
}
