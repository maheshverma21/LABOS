"use client";

import { Fragment, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RotateCcwIcon } from "lucide-react";
import { MODULES, PERMISSION_GROUPS, PERMISSION_LABEL, type LabAccess, type ModuleKey, type Permission } from "@lms/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api";
import { adminApi } from "@/lib/admin-api";
import { adminKeys, useLabAccess } from "@/lib/admin";
import { cn } from "@/lib/utils";

const toNum = (v: string) => (v.trim() === "" ? null : Math.max(1, Math.floor(Number(v)) || 1));

/** Which permissions a switched-off module takes away. */
const blockedBy = (disabled: string[]) => {
  const out = new Map<string, string>();
  for (const m of MODULES) if (disabled.includes(m.key)) for (const p of m.permissions) out.set(p, m.label);
  return out;
};

function Editor({ labId, access, canEdit }: { labId: string; access: LabAccess; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [disabled, setDisabled] = useState<string[]>(access.modules.filter((m) => !m.enabled).map((m) => m.key));
  const [roles, setRoles] = useState<Record<string, Permission[]>>(Object.fromEntries(access.roles.map((r) => [r.key, r.current])));
  const [maxUsers, setMaxUsers] = useState(access.limits.maxUsers?.toString() ?? "");
  const [maxBranches, setMaxBranches] = useState(access.limits.maxBranches?.toString() ?? "");
  const [reason, setReason] = useState("");

  const blocked = blockedBy(disabled);
  const dirty =
    JSON.stringify([...disabled].sort()) !== JSON.stringify(access.modules.filter((m) => !m.enabled).map((m) => m.key).sort()) ||
    access.roles.some((r) => JSON.stringify([...(roles[r.key] ?? [])].sort()) !== JSON.stringify([...r.current].sort())) ||
    (maxUsers || null) !== (access.limits.maxUsers?.toString() ?? null) ||
    (maxBranches || null) !== (access.limits.maxBranches?.toString() ?? null);

  const save = useMutation({
    mutationFn: () =>
      adminApi<{ access: LabAccess }>(`/labs/${labId}/access`, {
        method: "PUT",
        body: { disabledModules: disabled, roles, maxUsers: toNum(maxUsers), maxBranches: toNum(maxBranches), reason },
      }),
    onSuccess: async ({ access: saved }) => {
      queryClient.setQueryData(adminKeys.access(labId), saved);
      await queryClient.invalidateQueries({ queryKey: adminKeys.all });
      setReason("");
      toast.success("Access saved. It applies to the lab's users straight away.");
    },
    onError: (err) => toast.error(err instanceof ApiError ? (Object.values(err.fields ?? {})[0]?.[0] ?? err.message) : err.message),
  });

  const toggle = (role: string, p: Permission, on: boolean) =>
    setRoles((all) => ({ ...all, [role]: on ? [...(all[role] ?? []), p] : (all[role] ?? []).filter((x) => x !== p) }));
  const resetDefaults = () => {
    setRoles(Object.fromEntries(access.roles.map((r) => [r.key, r.defaults])));
    setDisabled([]);
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Modules</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {access.modules.map((m) => {
              const on = !disabled.includes(m.key);
              return (
                <label
                  key={m.key}
                  className={cn("flex items-start gap-3 rounded-lg border p-3", on ? "bg-card" : "bg-muted/50", canEdit && "cursor-pointer")}
                >
                  <Checkbox
                    checked={on}
                    disabled={!canEdit}
                    onCheckedChange={(v) => setDisabled((d) => (v === true ? d.filter((k) => k !== m.key) : [...d, m.key as ModuleKey]))}
                  />
                  <span className="grid gap-0.5">
                    <span className="text-sm font-medium">{m.label}</span>
                    <span className="text-xs text-muted-foreground">{m.description}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Limits</h3>
          <div className="grid gap-1.5">
            <Label htmlFor="max-users">Active users (now {access.usage.users})</Label>
            <Input id="max-users" inputMode="numeric" placeholder="No limit" disabled={!canEdit} value={maxUsers} onChange={(e) => setMaxUsers(e.target.value.replace(/\D/g, ""))} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="max-branches">Branches (now {access.usage.branches})</Label>
            <Input id="max-branches" inputMode="numeric" placeholder="No limit" disabled={!canEdit} value={maxBranches} onChange={(e) => setMaxBranches(e.target.value.replace(/\D/g, ""))} />
          </div>
          <p className="text-xs text-muted-foreground">Blank means no limit. Existing users and branches aren&apos;t removed; only new ones are refused.</p>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">What each role can do in this lab</h3>
            <p className="text-xs text-muted-foreground">
              Ticks in <span className="rounded bg-amber-100 px-1 text-amber-900 dark:bg-amber-950 dark:text-amber-200">amber</span> differ from the standard role. Struck-out permissions belong to a module that&apos;s switched off.
            </p>
          </div>
          {canEdit && (
            <Button variant="outline" size="sm" onClick={resetDefaults}>
              <RotateCcwIcon /> Standard roles, all modules
            </Button>
          )}
        </div>
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-56">Permission</TableHead>
                {access.roles.map((r) => (
                  <TableHead key={r.key} className="text-center whitespace-nowrap">
                    {r.name}
                    <div className="text-[11px] font-normal text-muted-foreground">{r.users} user{r.users === 1 ? "" : "s"}</div>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {PERMISSION_GROUPS.map((g) => (
                <Fragment key={g.label}>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableCell colSpan={access.roles.length + 1} className="py-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                      {g.label}
                    </TableCell>
                  </TableRow>
                  {g.permissions.map((p) => {
                    const off = blocked.get(p);
                    return (
                      <TableRow key={p}>
                        <TableCell className={cn("text-sm", off && "text-muted-foreground line-through")} title={off ? `${off} is switched off` : undefined}>
                          {PERMISSION_LABEL[p]}
                        </TableCell>
                        {access.roles.map((r) => {
                          const has = roles[r.key]?.includes(p) ?? false;
                          const changed = has !== r.defaults.includes(p);
                          return (
                            <TableCell key={r.key} className={cn("text-center", changed && "bg-amber-100/70 dark:bg-amber-950/50")}>
                              <Checkbox
                                aria-label={`${r.name}: ${PERMISSION_LABEL[p]}`}
                                checked={has}
                                disabled={!canEdit}
                                onCheckedChange={(v) => toggle(r.key, p, v === true)}
                              />
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    );
                  })}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {canEdit && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid min-w-72 flex-1 gap-1.5">
            <Label htmlFor="access-reason">Reason for the change</Label>
            <Textarea id="access-reason" rows={1} placeholder="e.g. Starter plan: no B2B; owner asked to restrict discounts" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <Button disabled={!dirty || reason.trim().length < 3 || save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Spinner />}
            Save access
          </Button>
        </div>
      )}
    </div>
  );
}

/** Platform admin: switch modules, adjust role permissions and set limits for one lab. */
export function LabAccessCard({ labId, canEdit }: { labId: string; canEdit: boolean }) {
  const { data, isPending, error } = useLabAccess(labId);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Access and permissions</CardTitle>
        <CardDescription>
          Control what this lab can use and what each of its roles, including the owner, is allowed to do.
          {!canEdit && " Only super admins can change these."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : error || !data ? (
          <p className="text-sm text-destructive">{error?.message ?? "Couldn't load"}</p>
        ) : (
          // Re-mount after a save so the editor starts from what the server now holds.
          <Editor key={JSON.stringify(data)} labId={labId} access={data} canEdit={canEdit} />
        )}
      </CardContent>
    </Card>
  );
}
