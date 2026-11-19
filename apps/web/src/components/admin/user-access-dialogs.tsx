"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { AdminUserDetail } from "@lms/shared";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api";
import { adminApi } from "@/lib/admin-api";
import { adminKeys, useAdminLab, useLabAccess } from "@/lib/admin";

const ALL = "all";
const errorText = (err: Error) => (err instanceof ApiError ? (Object.values(err.fields ?? {})[0]?.[0] ?? err.message) : err.message);

function useSaved(userId: string, message: string, close: () => void) {
  const queryClient = useQueryClient();
  return {
    onSuccess: async (data: { user?: AdminUserDetail }) => {
      if (data.user) queryClient.setQueryData(adminKeys.user(userId), data.user);
      await queryClient.invalidateQueries({ queryKey: adminKeys.all });
      toast.success(message);
      close();
    },
    onError: (err: Error) => toast.error(errorText(err)),
  };
}

/** Change any user's roles and branch, owners included. */
export function UserRolesDialog({ user, onClose }: { user: AdminUserDetail; onClose: () => void }) {
  const access = useLabAccess(user.lab.id);
  const lab = useAdminLab(user.lab.id);
  const [roleKeys, setRoleKeys] = useState<string[]>(user.roles.map((r) => r.key));
  const currentBranch = lab.data?.branchList.find((b) => b.name === user.branchScope?.[0])?.id;
  const [branchId, setBranchId] = useState<string | null>(null);
  const [touchedBranch, setTouchedBranch] = useState(false);
  const [reason, setReason] = useState("");
  const branch = touchedBranch ? branchId : (currentBranch ?? null);
  const save = useMutation({
    mutationFn: () => adminApi<{ user: AdminUserDetail }>(`/users/${user.id}/access`, { method: "PUT", body: { roleKeys, branchId: branch, reason } }),
    ...useSaved(user.id, "Roles updated. They apply straight away.", onClose),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Roles for {user.name}</DialogTitle>
          <DialogDescription>
            In {user.lab.name}. What each role allows is set on the lab&apos;s page.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2.5">
          {access.data?.roles.map((r) => (
            <label key={r.key} className="flex cursor-pointer items-center gap-3 text-sm">
              <Checkbox
                checked={roleKeys.includes(r.key)}
                onCheckedChange={(v) => setRoleKeys((k) => (v === true ? [...k, r.key] : k.filter((x) => x !== r.key)))}
              />
              {r.name}
              <span className="text-xs text-muted-foreground">{r.effective.length} permissions</span>
            </label>
          ))}
        </div>
        {(lab.data?.branchList.length ?? 0) > 1 && (
          <div className="grid gap-1.5">
            <Label htmlFor="ua-branch">Branch access</Label>
            <Select
              value={branch ?? ALL}
              onValueChange={(v) => {
                setTouchedBranch(true);
                setBranchId(v === ALL ? null : v);
              }}
            >
              <SelectTrigger id="ua-branch" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All branches</SelectItem>
                {lab.data?.branchList.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="grid gap-1.5">
          <Label htmlFor="ua-reason">Reason</Label>
          <Textarea id="ua-reason" rows={2} placeholder="e.g. Owner asked by email to make her a branch manager" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <DialogFooter>
          <Button disabled={roleKeys.length === 0 || reason.trim().length < 3 || save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Spinner />}
            Save roles
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Help someone back in: email a reset link, or set a temporary password to give them by phone. */
export function UserPasswordDialog({ user, onClose }: { user: AdminUserDetail; onClose: () => void }) {
  const [mode, setMode] = useState<"link" | "temp">("link");
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const done = useSaved(user.id, mode === "link" ? `Reset link emailed to ${user.email}` : "Temporary password set. They'll choose their own at sign-in.", onClose);
  const run = useMutation({
    mutationFn: () =>
      mode === "link"
        ? adminApi<{ sent: boolean }>(`/users/${user.id}/send-reset`, { method: "POST", body: { reason } }).then((r) => {
            if (!r.sent) throw new Error("The email couldn't be sent. Set a temporary password instead.");
            return {};
          })
        : adminApi<{ user: AdminUserDetail }>(`/users/${user.id}/password`, { method: "POST", body: { password, reason } }),
    ...done,
  });
  const ok = reason.trim().length >= 3 && (mode === "link" || password.length >= 8);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Password help for {user.name}</DialogTitle>
          <DialogDescription>Check who you&apos;re talking to before doing this; it&apos;s recorded in the audit log.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant={mode === "link" ? "default" : "outline"} onClick={() => setMode("link")}>
            Email a reset link
          </Button>
          <Button type="button" variant={mode === "temp" ? "default" : "outline"} onClick={() => setMode("temp")}>
            Temporary password
          </Button>
        </div>
        {mode === "temp" && (
          <div className="grid gap-1.5">
            <Label htmlFor="up-password">Temporary password</Label>
            <Input id="up-password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
            <p className="text-xs text-muted-foreground">At least 8 characters. They&apos;re signed out everywhere and must change it at sign-in.</p>
          </div>
        )}
        <div className="grid gap-1.5">
          <Label htmlFor="up-reason">Reason</Label>
          <Textarea id="up-reason" rows={2} placeholder="e.g. Owner locked out, identity checked by phone" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <DialogFooter>
          <Button disabled={!ok || run.isPending} onClick={() => run.mutate()}>
            {run.isPending && <Spinner />}
            {mode === "link" ? "Send link" : "Set password"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
