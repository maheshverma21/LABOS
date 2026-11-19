"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeftIcon, CheckIcon, KeyRoundIcon, LogOutIcon, ShieldIcon, UserCheckIcon, UserXIcon } from "lucide-react";
import { formatTenure, PERMISSIONS, type AdminUserDetail } from "@lms/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { AuditList } from "@/components/admin/audit-list";
import { UserPasswordDialog, UserRolesDialog } from "@/components/admin/user-access-dialogs";
import { LabStatusBadge, PlanBadge, UserStatusBadge } from "@/components/admin/badges";
import { useAdminAuth } from "@/providers/admin-auth-provider";
import { adminApi } from "@/lib/admin-api";
import { actionLabel, adminKeys, fmtDate, fmtDateTime, useAdminUser } from "@/lib/admin";
import { cn } from "@/lib/utils";

type Action = "disable" | "enable" | "sign-out";

const ACTION_COPY: Record<Action, { title: string; description: string; button: string; placeholder: string }> = {
  disable: {
    title: "Disable this user",
    description: "They're signed out of every device straight away and can't sign in until enabled again.",
    button: "Disable user",
    placeholder: "e.g. Lab owner asked: staff member has left",
  },
  enable: { title: "Enable this user", description: "They can sign in again with their existing password.", button: "Enable user", placeholder: "e.g. Rejoined the lab" },
  "sign-out": {
    title: "Sign out everywhere",
    description: "Ends every session on every device. Their account stays active.",
    button: "Sign out everywhere",
    placeholder: "e.g. Lost phone",
  },
};

function ActionDialog({ user, action, onClose }: { user: AdminUserDetail; action: Action; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const copy = ACTION_COPY[action];
  const run = useMutation({
    mutationFn: () =>
      action === "sign-out"
        ? adminApi<{ user: AdminUserDetail }>(`/users/${user.id}/sign-out`, { method: "POST", body: { reason } })
        : adminApi<{ user: AdminUserDetail }>(`/users/${user.id}/status`, { method: "POST", body: { isActive: action === "enable", reason } }),
    onSuccess: ({ user: saved }) => {
      queryClient.setQueryData(adminKeys.user(user.id), saved);
      queryClient.invalidateQueries({ queryKey: adminKeys.all });
      toast.success(action === "disable" ? "User disabled" : action === "enable" ? "User enabled" : "Signed out everywhere");
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {copy.title}: {user.name}
          </DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="act-reason">Reason</Label>
          <Textarea id="act-reason" rows={2} placeholder={copy.placeholder} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        </div>
        <DialogFooter>
          <Button variant={action === "enable" ? "default" : "destructive"} disabled={reason.trim().length < 3 || run.isPending} onClick={() => run.mutate()}>
            {run.isPending && <Spinner />}
            {copy.button}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "Chrome on Windows" from a user agent, good enough to recognise a device. */
function deviceName(ua: string | null) {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

export default function AdminUserPage() {
  const { id } = useParams<{ id: string }>();
  const { isSuper } = useAdminAuth();
  const { data: u, isPending, error } = useAdminUser(id);
  const [action, setAction] = useState<Action | null>(null);
  const [dialog, setDialog] = useState<"roles" | "password" | null>(null);

  if (isPending) return <Skeleton className="h-96 w-full" />;
  if (error || !u) return <p className="text-sm text-destructive">{error?.message ?? "User not found"}</p>;

  const granted = new Set(u.permissions);
  const groups = [...new Set(PERMISSIONS.map((p) => p.split(":")[0]!))];

  return (
    <>
      <title>{`${u.name} · Platform admin`}</title>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/admin/users" aria-label="Back to users">
            <ArrowLeftIcon />
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
            {u.name} <UserStatusBadge active={u.isActive} />
          </h1>
          <p className="text-sm text-muted-foreground">
            {u.email}
            {u.phone && ` · ${u.phone}`}
          </p>
        </div>
        {isSuper && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setDialog("roles")}>
              <ShieldIcon /> Roles
            </Button>
            {u.isActive && (
              <Button variant="outline" onClick={() => setDialog("password")}>
                <KeyRoundIcon /> Password help
              </Button>
            )}
            {u.isActive && u.sessions.length > 0 && (
              <Button variant="outline" onClick={() => setAction("sign-out")}>
                <LogOutIcon /> Sign out everywhere
              </Button>
            )}
            {u.isActive ? (
              <Button variant="destructive" onClick={() => setAction("disable")}>
                <UserXIcon /> Disable
              </Button>
            ) : (
              <Button onClick={() => setAction("enable")}>
                <UserCheckIcon /> Enable
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Lab</span>
              <Link href={`/admin/labs/${u.lab.id}`} className="text-right font-medium hover:underline">
                {u.lab.name}
              </Link>
            </div>
            <div className="flex justify-end gap-1.5">
              <PlanBadge plan={u.lab.plan} /> <LabStatusBadge status={u.lab.status} />
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">With the lab for</span>
              <span>
                {formatTenure(u.createdAt)} (since {fmtDate(u.createdAt)})
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Last sign-in</span>
              <span>{u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : "Never"}</span>
            </div>
            {u.qualification && (
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Qualification</span>
                <span>{u.qualification}</span>
              </div>
            )}
            {u.registrationNo && (
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Registration no.</span>
                <span>{u.registrationNo}</span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Access</CardTitle>
            <CardDescription>
              {u.roles.map((r) => r.name).join(", ") || "No roles"} ·{" "}
              {u.branchScope === null ? "all branches" : `only ${u.branchScope.join(", ")}`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {groups.map((g) => (
                <div key={g}>
                  <div className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{g}</div>
                  <div className="flex flex-wrap gap-1">
                    {PERMISSIONS.filter((p) => p.startsWith(`${g}:`)).map((p) => (
                      <Badge
                        key={p}
                        variant="outline"
                        className={cn(granted.has(p) ? "border-emerald-600/30 text-emerald-700 dark:text-emerald-400" : "text-muted-foreground/60 line-through")}
                      >
                        {granted.has(p) && <CheckIcon />}
                        {p.split(":")[1]}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Signed in on</CardTitle>
            <CardDescription>{u.sessions.length ? `${u.sessions.length} active device${u.sessions.length === 1 ? "" : "s"}` : "No active sessions"}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {u.sessions.map((s) => (
                <li key={s.id} className="flex justify-between gap-4">
                  <span>
                    {deviceName(s.userAgent)}
                    <span className="block text-xs text-muted-foreground">{s.ip ?? "Unknown IP"}</span>
                  </span>
                  <span className="text-right text-xs text-muted-foreground">
                    Last used {fmtDateTime(s.lastUsedAt)}
                    <span className="block">Since {fmtDateTime(s.createdAt)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Recent activity in the lab</CardTitle>
          </CardHeader>
          <CardContent>
            {u.activity.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing yet.</p>
            ) : (
              <ul className="max-h-72 space-y-1.5 overflow-y-auto text-sm">
                {u.activity.map((a) => (
                  <li key={a.id} className="flex justify-between gap-4">
                    <span>{actionLabel(a.action)}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{fmtDateTime(a.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Admin history</h2>
        <AuditList items={u.history} empty="No platform admin has changed this user." />
      </section>

      {action && <ActionDialog key={action} user={u} action={action} onClose={() => setAction(null)} />}
      {dialog === "roles" && <UserRolesDialog user={u} onClose={() => setDialog(null)} />}
      {dialog === "password" && <UserPasswordDialog user={u} onClose={() => setDialog(null)} />}
    </>
  );
}
