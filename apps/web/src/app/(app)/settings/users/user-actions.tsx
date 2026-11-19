"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { KeyRoundIcon, MailIcon, MoreHorizontalIcon, PencilIcon, ShieldIcon, UserCheckIcon, UserXIcon } from "lucide-react";
import { passwordSchema, SYSTEM_ROLES, type RoleListItem, type UserListItem } from "@lms/shared";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/providers/auth-provider";
import { ApiError, api } from "@/lib/api";
import { useLab } from "@/lib/orders";
import { roleHint } from "./add-user-dialog";
import { EditUserDialog } from "./edit-user-dialog";

const ALL_BRANCHES = "all";
type Open = "edit" | "access" | "status" | "password" | null;

function useDone(close: () => void) {
  const queryClient = useQueryClient();
  return async (message: string) => {
    toast.success(message);
    await queryClient.invalidateQueries({ queryKey: ["users"] });
    close();
  };
}

function AccessDialog({ user, onClose }: { user: UserListItem; onClose: () => void }) {
  const { user: me } = useAuth();
  const done = useDone(onClose);
  const lab = useLab();
  const roles = useQuery({ queryKey: ["roles"], queryFn: () => api<{ roles: RoleListItem[] }>("/users/roles") });
  const [roleKeys, setRoleKeys] = useState<string[]>(user.roles.map((r) => r.key));
  const [branchId, setBranchId] = useState<string>(user.branchId ?? ALL_BRANCHES);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => api(`/users/${user.id}/access`, { method: "PUT", body: { roleKeys, branchId: branchId === ALL_BRANCHES ? null : branchId } }),
    onSuccess: () => done(`${user.name}'s access updated. It applies straight away.`),
    onError: (err) => setError(err instanceof ApiError ? (Object.values(err.fields ?? {})[0]?.[0] ?? err.message) : err.message),
  });

  const sorted = [...(roles.data?.roles ?? [])]
    .filter((r) => r.key !== "owner" || me?.roles.includes("owner"))
    .sort((a, b) => SYSTEM_ROLES.findIndex((r) => r.key === a.key) - SYSTEM_ROLES.findIndex((r) => r.key === b.key));
  const branches = lab.data?.branches.filter((b) => b.isActive) ?? [];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Roles and branch for {user.name}</DialogTitle>
          <DialogDescription>Changes apply at once, even if they&apos;re signed in.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {roles.isPending && <Spinner className="text-muted-foreground" />}
          {sorted.map((role) => (
            <div key={role.id} className="flex items-start gap-3">
              <Checkbox
                id={`access-${role.key}`}
                checked={roleKeys.includes(role.key)}
                onCheckedChange={(next) => setRoleKeys((k) => (next ? [...k, role.key] : k.filter((x) => x !== role.key)))}
              />
              <div className="grid gap-0.5 leading-none">
                <Label htmlFor={`access-${role.key}`}>{role.name}</Label>
                {roleHint(role.key) && <span className="text-xs text-muted-foreground">{roleHint(role.key)}</span>}
              </div>
            </div>
          ))}
        </div>
        {branches.length > 1 && (
          <div className="grid gap-1.5">
            <Label htmlFor="access-branch">Branch access</Label>
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger id="access-branch" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_BRANCHES}>All branches</SelectItem>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button disabled={roleKeys.length === 0 || save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Spinner />}
            Save access
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatusDialog({ user, onClose }: { user: UserListItem; onClose: () => void }) {
  const done = useDone(onClose);
  const disabling = user.isActive;
  const run = useMutation({
    mutationFn: () => api(`/users/${user.id}/status`, { method: "POST", body: { isActive: !disabling } }),
    onSuccess: () => done(disabling ? `${user.name} can no longer sign in` : `${user.name} can sign in again`),
    onError: (err) => toast.error(err.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{disabling ? `Disable ${user.name}?` : `Enable ${user.name}?`}</DialogTitle>
          <DialogDescription>
            {disabling
              ? "They're signed out of every device straight away and can't sign in. Their work (bills, results) stays as it is. You can enable them again later."
              : "They can sign in again with their existing password."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={disabling ? "destructive" : "default"} disabled={run.isPending} onClick={() => run.mutate()}>
            {run.isPending && <Spinner />}
            {disabling ? "Disable" : "Enable"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TemporaryPasswordDialog({ user, onClose }: { user: UserListItem; onClose: () => void }) {
  const done = useDone(onClose);
  const [password, setPassword] = useState("");
  const valid = passwordSchema.safeParse(password).success;
  const run = useMutation({
    mutationFn: () => api(`/users/${user.id}/password`, { method: "POST", body: { password } }),
    onSuccess: () => done(`Temporary password set. Give it to ${user.name} in person or by phone.`),
    onError: (err) => toast.error(err.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) run.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>Set a temporary password for {user.name}</DialogTitle>
            <DialogDescription>
              For staff without email access. They&apos;re signed out everywhere, and must choose their own password the next time they sign in.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="temp-password">Temporary password</Label>
            <Input id="temp-password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
            <p className="text-xs text-muted-foreground">At least 8 characters.</p>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!valid || run.isPending}>
              {run.isPending && <Spinner />}
              Set password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The ⋯ menu on a user row: everything an owner can do for a staff member. */
export function UserActions({ user }: { user: UserListItem }) {
  const { user: me } = useAuth();
  const [open, setOpen] = useState<Open>(null);
  const close = () => setOpen(null);
  const isMe = user.id === me?.id;
  const isOwner = user.roles.some((r) => r.key === "owner");
  // Owners are only managed by owners, and your own account is managed in Security.
  const canManage = !isMe && (!isOwner || !!me?.roles.includes("owner"));

  const sendReset = useMutation({
    mutationFn: () => api<{ sent: boolean }>(`/users/${user.id}/send-reset`, { method: "POST" }),
    onSuccess: ({ sent }) =>
      sent
        ? toast.success(`Reset link emailed to ${user.email}`)
        : toast.error("The email couldn't be sent. Set a temporary password instead."),
    onError: (err) => toast.error(err.message),
  });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${user.name}`}>
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onSelect={() => setOpen("edit")}>
            <PencilIcon /> Edit details
          </DropdownMenuItem>
          {canManage && (
            <>
              <DropdownMenuItem onSelect={() => setOpen("access")}>
                <ShieldIcon /> Roles and branch
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={!user.isActive || sendReset.isPending} onSelect={() => sendReset.mutate()}>
                <MailIcon /> Email a password reset link
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!user.isActive} onSelect={() => setOpen("password")}>
                <KeyRoundIcon /> Set a temporary password
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant={user.isActive ? "destructive" : "default"} onSelect={() => setOpen("status")}>
                {user.isActive ? <UserXIcon /> : <UserCheckIcon />}
                {user.isActive ? "Disable" : "Enable"}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {open === "edit" && <EditUserDialog user={user} onOpenChange={(o) => !o && close()} />}
      {open === "access" && <AccessDialog user={user} onClose={close} />}
      {open === "status" && <StatusDialog user={user} onClose={close} />}
      {open === "password" && <TemporaryPasswordDialog user={user} onClose={close} />}
    </>
  );
}
