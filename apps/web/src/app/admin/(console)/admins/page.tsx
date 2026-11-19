"use client";

import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PlusIcon } from "lucide-react";
import { createPlatformAdminSchema, PLATFORM_ROLE_LABEL, type PlatformAdminItem } from "@lms/shared";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/app-shell/page-header";
import { UserStatusBadge } from "@/components/admin/badges";
import { useAdminAuth } from "@/providers/admin-auth-provider";
import { adminApi } from "@/lib/admin-api";
import { adminKeys, fmtDate, fmtDateTime, usePlatformAdmins } from "@/lib/admin";
import { showFormError } from "@/lib/forms";

type Values = z.input<typeof createPlatformAdminSchema>;

function AddAdminDialog({ onOpenChange }: { onOpenChange: (o: boolean) => void }) {
  const queryClient = useQueryClient();
  const form = useForm<Values, unknown, z.output<typeof createPlatformAdminSchema>>({
    resolver: zodResolver(createPlatformAdminSchema),
    defaultValues: { name: "", email: "", password: "", role: "SUPPORT" },
  });
  const { errors } = form.formState;
  const save = useMutation({
    mutationFn: (v: z.output<typeof createPlatformAdminSchema>) => adminApi("/admins", { method: "POST", body: v }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminKeys.admins() });
      toast.success("Admin added. Share the password with them privately.");
      onOpenChange(false);
    },
    onError: (err) => showFormError(err, form.setError),
  });
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form noValidate className="grid gap-5" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
          <DialogHeader>
            <DialogTitle>Add a platform admin</DialogTitle>
            <DialogDescription>Someone on your team. Support admins can look but not change anything.</DialogDescription>
          </DialogHeader>
          <FieldGroup className="grid gap-4">
            <Field data-invalid={!!errors.name}>
              <FieldLabel htmlFor="a-name">Name</FieldLabel>
              <Input id="a-name" {...form.register("name")} />
              <FieldError errors={[errors.name]} />
            </Field>
            <Field data-invalid={!!errors.email}>
              <FieldLabel htmlFor="a-email">Email</FieldLabel>
              <Input id="a-email" type="email" autoComplete="off" {...form.register("email")} />
              <FieldError errors={[errors.email]} />
            </Field>
            <Field data-invalid={!!errors.password}>
              <FieldLabel htmlFor="a-password">Password</FieldLabel>
              <Input id="a-password" type="password" autoComplete="new-password" {...form.register("password")} />
              <FieldDescription>At least 12 characters.</FieldDescription>
              <FieldError errors={[errors.password]} />
            </Field>
            <Field>
              <FieldLabel htmlFor="a-role">Role</FieldLabel>
              <Controller
                control={form.control}
                name="role"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="a-role" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="SUPPORT">{PLATFORM_ROLE_LABEL.SUPPORT}</SelectItem>
                      <SelectItem value="SUPER_ADMIN">{PLATFORM_ROLE_LABEL.SUPER_ADMIN}</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Spinner />}
              Add admin
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function PlatformAdminsPage() {
  const { isSuper, admin: me } = useAdminAuth();
  const queryClient = useQueryClient();
  const { data, isPending } = usePlatformAdmins(isSuper);
  const [adding, setAdding] = useState(false);
  const resetMfa = useMutation({
    mutationFn: (a: PlatformAdminItem) => adminApi(`/admins/${a.id}/reset-mfa`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Two-step sign-in reset. They'll set it up again at their next sign-in.");
      return queryClient.invalidateQueries({ queryKey: adminKeys.admins() });
    },
    onError: (err) => toast.error(err.message),
  });
  const toggle = useMutation({
    mutationFn: (a: PlatformAdminItem) => adminApi(`/admins/${a.id}/status`, { method: "POST", body: { isActive: !a.isActive } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: adminKeys.admins() }),
    onError: (err) => toast.error(err.message),
  });

  if (!isSuper) return <PageHeader title="Admins" description="Only super admins can manage platform admins." />;

  return (
    <>
      <title>Admins · Platform admin</title>
      <PageHeader
        title="Admins"
        description="Your team's access to this console."
        actions={
          <Button onClick={() => setAdding(true)}>
            <PlusIcon /> Add admin
          </Button>
        }
      />
      <div className="overflow-x-auto rounded-lg border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Two-step</TableHead>
              <TableHead>Added</TableHead>
              <TableHead>Last sign-in</TableHead>
              <TableHead className="text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending && (
              <TableRow>
                <TableCell colSpan={7}>
                  <Skeleton className="h-5 w-full" />
                </TableCell>
              </TableRow>
            )}
            {data?.map((a) => (
              <TableRow key={a.id}>
                <TableCell>
                  <div className="font-medium">
                    {a.name}
                    {a.id === me?.id && <span className="text-muted-foreground"> (you)</span>}
                  </div>
                  <div className="text-xs text-muted-foreground">{a.email}</div>
                </TableCell>
                <TableCell>{PLATFORM_ROLE_LABEL[a.role]}</TableCell>
                <TableCell>
                  <UserStatusBadge active={a.isActive} />
                </TableCell>
                <TableCell>
                  {a.mfaEnabled ? <span className="text-emerald-700 dark:text-emerald-400">On</span> : <span className="text-muted-foreground">Not set up</span>}
                </TableCell>
                <TableCell>{fmtDate(a.createdAt)}</TableCell>
                <TableCell className="text-muted-foreground">{a.lastLoginAt ? fmtDateTime(a.lastLoginAt) : "Never"}</TableCell>
                <TableCell className="text-right">
                  {a.id !== me?.id && (
                    <div className="flex justify-end gap-1">
                      {a.mfaEnabled && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={resetMfa.isPending}
                          onClick={() => {
                            if (window.confirm(`Reset two-step sign-in for ${a.name}? Use this only if they've lost their phone and recovery codes.`)) resetMfa.mutate(a);
                          }}
                        >
                          Reset two-step
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" disabled={toggle.isPending} onClick={() => toggle.mutate(a)}>
                        {a.isActive ? "Disable" : "Enable"}
                      </Button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {adding && <AddAdminDialog onOpenChange={setAdding} />}
    </>
  );
}
