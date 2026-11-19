"use client";

import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { signupSchema } from "@lms/shared";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/providers/auth-provider";
import { showFormError } from "@/lib/forms";

type FormValues = z.input<typeof signupSchema>;

export function SignupForm() {
  const { signup } = useAuth();

  const form = useForm<FormValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: { labName: "", ownerName: "", email: "", phone: "", password: "" },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await signup(signupSchema.parse(values));
    } catch (err) {
      showFormError(err, form.setError);
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Create your lab account</h1>
        <p className="text-sm text-muted-foreground">You&apos;ll be the owner. You can add your staff next.</p>
      </div>

      <FieldGroup>
        <Field data-invalid={!!errors.labName}>
          <FieldLabel htmlFor="labName">Lab name</FieldLabel>
          <Input id="labName" autoFocus aria-invalid={!!errors.labName} {...form.register("labName")} />
          <FieldError errors={[errors.labName]} />
        </Field>
        <Field data-invalid={!!errors.ownerName}>
          <FieldLabel htmlFor="ownerName">Your name</FieldLabel>
          <Input id="ownerName" autoComplete="name" aria-invalid={!!errors.ownerName} {...form.register("ownerName")} />
          <FieldError errors={[errors.ownerName]} />
        </Field>
        <Field data-invalid={!!errors.email}>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input id="email" type="email" autoComplete="email" aria-invalid={!!errors.email} {...form.register("email")} />
          <FieldError errors={[errors.email]} />
        </Field>
        <Field data-invalid={!!errors.phone}>
          <FieldLabel htmlFor="phone">Mobile number</FieldLabel>
          <Input
            id="phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            maxLength={10}
            aria-invalid={!!errors.phone}
            {...form.register("phone")}
          />
          <FieldError errors={[errors.phone]} />
        </Field>
        <Field data-invalid={!!errors.password}>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            aria-invalid={!!errors.password}
            {...form.register("password")}
          />
          {errors.password ? (
            <FieldError errors={[errors.password]} />
          ) : (
            <FieldDescription>At least 8 characters.</FieldDescription>
          )}
        </Field>
        <Button type="submit" disabled={isSubmitting} className="w-full">
          {isSubmitting && <Spinner />}
          Create lab account
        </Button>
      </FieldGroup>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-foreground underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </form>
  );
}
