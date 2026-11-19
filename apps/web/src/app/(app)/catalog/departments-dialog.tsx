"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { departmentSchema } from "@lms/shared";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/providers/auth-provider";
import { api } from "@/lib/api";
import { catalogKeys, useDepartments } from "@/lib/catalog";
import { showFormError } from "@/lib/forms";

export function DepartmentsDialog({ trigger }: { trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { can } = useAuth();
  const departments = useDepartments();
  const queryClient = useQueryClient();

  const form = useForm<z.input<typeof departmentSchema>>({
    resolver: zodResolver(departmentSchema),
    defaultValues: { name: "" },
  });

  const create = useMutation({
    mutationFn: (name: string) => api("/catalog/departments", { method: "POST", body: { name } }),
    onSuccess: async (_d, name) => {
      toast.success(`Added ${name}`);
      form.reset();
      await queryClient.invalidateQueries({ queryKey: catalogKeys.departments() });
    },
    onError: (err) => showFormError(err, form.setError),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Departments</DialogTitle>
          <DialogDescription>Tests are grouped by department on worklists and reports.</DialogDescription>
        </DialogHeader>

        <ul className="divide-y rounded-lg border text-sm">
          {departments.data?.map((d) => (
            <li key={d.id} className="flex items-center justify-between px-3 py-2">
              <span>{d.name}</span>
              <span className="text-muted-foreground">
                {d.testCount} {d.testCount === 1 ? "test" : "tests"}
              </span>
            </li>
          ))}
          {departments.data?.length === 0 && <li className="px-3 py-2 text-muted-foreground">No departments yet.</li>}
        </ul>

        {can("catalog:write") && (
          <form
            noValidate
            className="flex items-start gap-2"
            onSubmit={form.handleSubmit((v) => create.mutate(departmentSchema.parse(v).name))}
          >
            <Field data-invalid={!!form.formState.errors.name} className="flex-1">
              <Input
                placeholder="New department name"
                aria-label="New department name"
                aria-invalid={!!form.formState.errors.name}
                {...form.register("name")}
              />
              <FieldError errors={[form.formState.errors.name]} />
            </Field>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending && <Spinner />}
              Add
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
