"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PlusIcon } from "lucide-react";
import { createUserSchema, SYSTEM_ROLES, type RoleListItem } from "@lms/shared";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/providers/auth-provider";
import { api } from "@/lib/api";
import { showFormError } from "@/lib/forms";

type FormValues = z.input<typeof createUserSchema>;

const ALL_BRANCHES = "all";
export const roleHint = (key: string) =>
  ({
    branch_manager: "Runs a branch: billing, discounts, staff list, reports",
    front_desk: "Registers patients, creates orders, takes payments",
    phlebotomist: "Collects samples",
    technician: "Receives samples and enters results",
    pathologist: "Reviews, approves and signs reports",
    owner: "Full access to everything",
  })[key];

export function AddUserDialog() {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const roles = useQuery({
    queryKey: ["roles"],
    queryFn: () => api<{ roles: RoleListItem[] }>("/users/roles"),
    enabled: open,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { name: "", email: "", phone: "", password: "", roleKeys: [], branchId: undefined },
  });
  const { errors } = form.formState;

  const create = useMutation({
    mutationFn: (values: z.output<typeof createUserSchema>) => api("/users", { method: "POST", body: values }),
    onSuccess: async (_data, values) => {
      toast.success(`${values.name} can now sign in`);
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      setOpen(false);
    },
    onError: (err) => showFormError(err, form.setError),
  });

  const onSubmit = form.handleSubmit((values) => create.mutate(createUserSchema.parse(values)));

  // Only owners may grant the owner role; the API enforces this too.
  const assignable = (roles.data?.roles ?? []).filter((r) => r.key !== "owner" || user?.roles.includes("owner"));
  const sortedRoles = [...assignable].sort(
    (a, b) => SYSTEM_ROLES.findIndex((r) => r.key === a.key) - SYSTEM_ROLES.findIndex((r) => r.key === b.key),
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Reset on open, not on close, so the closing animation doesn't flash an empty form.
        if (next) form.reset();
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <PlusIcon /> Add user
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={onSubmit} noValidate className="grid gap-6">
          <DialogHeader>
            <DialogTitle>Add a staff member</DialogTitle>
            <DialogDescription>They sign in with this email and password. Share it with them securely.</DialogDescription>
          </DialogHeader>

          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field data-invalid={!!errors.name}>
                <FieldLabel htmlFor="name">Full name</FieldLabel>
                <Input id="name" aria-invalid={!!errors.name} {...form.register("name")} />
                <FieldError errors={[errors.name]} />
              </Field>
              <Field data-invalid={!!errors.phone}>
                <FieldLabel htmlFor="phone">Mobile (optional)</FieldLabel>
                <Input id="phone" type="tel" maxLength={10} aria-invalid={!!errors.phone} {...form.register("phone")} />
                <FieldError errors={[errors.phone]} />
              </Field>
            </div>
            <Field data-invalid={!!errors.email}>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input id="email" type="email" aria-invalid={!!errors.email} {...form.register("email")} />
              <FieldError errors={[errors.email]} />
            </Field>
            <Field data-invalid={!!errors.password}>
              <FieldLabel htmlFor="new-password">Temporary password</FieldLabel>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                aria-invalid={!!errors.password}
                {...form.register("password")}
              />
              {errors.password ? <FieldError errors={[errors.password]} /> : <FieldDescription>At least 8 characters.</FieldDescription>}
            </Field>

            <FieldSet data-invalid={!!errors.roleKeys}>
              <FieldLegend variant="label">Roles</FieldLegend>
              {roles.isPending && <Spinner className="text-muted-foreground" />}
              <Controller
                control={form.control}
                name="roleKeys"
                render={({ field }) => (
                  <div className="grid gap-3" data-slot="checkbox-group">
                    {sortedRoles.map((role) => {
                      const checked = field.value.includes(role.key);
                      return (
                        <div key={role.id} className="flex items-start gap-3">
                          <Checkbox
                            id={`role-${role.key}`}
                            checked={checked}
                            onCheckedChange={(next) =>
                              field.onChange(next ? [...field.value, role.key] : field.value.filter((k) => k !== role.key))
                            }
                          />
                          <div className="grid gap-0.5 leading-none">
                            <Label htmlFor={`role-${role.key}`}>{role.name}</Label>
                            {roleHint(role.key) && (
                              <span className="text-xs text-muted-foreground">{roleHint(role.key)}</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              />
              <FieldError errors={[errors.roleKeys]} />
            </FieldSet>

            {(user?.branches.length ?? 0) > 1 && (
              <Field data-invalid={!!errors.branchId}>
                <FieldLabel>Branch access</FieldLabel>
                <Controller
                  control={form.control}
                  name="branchId"
                  render={({ field }) => (
                    <Select
                      value={field.value ?? ALL_BRANCHES}
                      onValueChange={(v) => field.onChange(v === ALL_BRANCHES ? undefined : v)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ALL_BRANCHES}>All branches</SelectItem>
                        {user?.branches.map((b) => (
                          <SelectItem key={b.id} value={b.id}>
                            {b.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                <FieldError errors={[errors.branchId]} />
              </Field>
            )}
          </FieldGroup>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending && <Spinner />}
              Add user
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
