"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CircleCheckIcon } from "lucide-react";
import { passwordSchema } from "@lms/shared";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api";
import { showFormError } from "@/lib/forms";

const schema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "The passwords don't match" });
type Values = z.input<typeof schema>;

export function ResetPasswordForm() {
  const token = useSearchParams().get("token") ?? "";
  const [done, setDone] = useState(false);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { password: "", confirm: "" } });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await api("/auth/reset-password", { method: "POST", body: { token, password: values.password } });
      setDone(true);
    } catch (err) {
      showFormError(err, form.setError);
    }
  });

  if (done) {
    return (
      <div className="flex flex-col gap-4">
        <CircleCheckIcon className="size-8 text-emerald-600" />
        <h1 className="text-2xl font-semibold tracking-tight">Password changed</h1>
        <p className="text-sm text-muted-foreground">You&apos;ve been signed out of every device. Sign in with your new password.</p>
        <Button asChild className="w-full">
          <Link href="/login">Sign in</Link>
        </Button>
      </div>
    );
  }

  if (token.length < 20) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">This link isn&apos;t complete</h1>
        <p className="text-sm text-muted-foreground">Open the link from the email again, or ask for a new one.</p>
        <Link href="/forgot-password" className="text-sm font-medium underline underline-offset-4">
          Send a new link
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
        <p className="text-sm text-muted-foreground">You&apos;ll be signed out of every device and can sign in with the new one.</p>
      </div>
      <FieldGroup>
        <Field data-invalid={!!errors.password}>
          <FieldLabel htmlFor="password">New password</FieldLabel>
          <Input id="password" type="password" autoComplete="new-password" autoFocus aria-invalid={!!errors.password} {...form.register("password")} />
          <FieldDescription>At least 8 characters.</FieldDescription>
          <FieldError errors={[errors.password]} />
        </Field>
        <Field data-invalid={!!errors.confirm}>
          <FieldLabel htmlFor="confirm">Type it again</FieldLabel>
          <Input id="confirm" type="password" autoComplete="new-password" aria-invalid={!!errors.confirm} {...form.register("confirm")} />
          <FieldError errors={[errors.confirm]} />
        </Field>
        <Button type="submit" disabled={isSubmitting} className="w-full">
          {isSubmitting && <Spinner />}
          Save new password
        </Button>
      </FieldGroup>
      <p className="text-center text-sm text-muted-foreground">
        Link expired?{" "}
        <Link href="/forgot-password" className="font-medium text-foreground underline underline-offset-4">
          Send a new one
        </Link>
      </p>
    </form>
  );
}
