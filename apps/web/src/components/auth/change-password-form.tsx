"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { changePasswordSchema, type ChangePasswordInput } from "@lms/shared";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { showFormError } from "@/lib/forms";

/**
 * Current password plus a new one. `submit` sends it (the lab app and the
 * admin console use different endpoints); `onDone` runs after it succeeds.
 */
export function ChangePasswordForm({
  submit,
  onDone,
  minLength = 8,
  submitLabel = "Change password",
}: {
  submit: (values: ChangePasswordInput) => Promise<unknown>;
  onDone?: () => void;
  minLength?: number;
  submitLabel?: string;
}) {
  const form = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: "", newPassword: "" },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    if (values.newPassword.length < minLength) {
      form.setError("newPassword", { message: `At least ${minLength} characters` });
      return;
    }
    try {
      await submit(values);
      form.reset();
      onDone?.();
    } catch (err) {
      showFormError(err, form.setError);
    }
  });

  return (
    <form noValidate onSubmit={onSubmit}>
      <FieldGroup className="grid gap-4">
        <Field data-invalid={!!errors.currentPassword}>
          <FieldLabel htmlFor="cp-current">Current password</FieldLabel>
          <Input id="cp-current" type="password" autoComplete="current-password" aria-invalid={!!errors.currentPassword} {...form.register("currentPassword")} />
          <FieldError errors={[errors.currentPassword]} />
        </Field>
        <Field data-invalid={!!errors.newPassword}>
          <FieldLabel htmlFor="cp-new">New password</FieldLabel>
          <Input id="cp-new" type="password" autoComplete="new-password" aria-invalid={!!errors.newPassword} {...form.register("newPassword")} />
          <FieldDescription>At least {minLength} characters. Your other devices will be signed out.</FieldDescription>
          <FieldError errors={[errors.newPassword]} />
        </Field>
        <div>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting && <Spinner />}
            {submitLabel}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
