"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ShieldCheckIcon } from "lucide-react";
import { loginSchema } from "@lms/shared";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/providers/auth-provider";
import { useAdminAuth } from "@/providers/admin-auth-provider";
import { ApiError } from "@/lib/api";
import { showFormError } from "@/lib/forms";

type FormValues = z.input<typeof loginSchema>;

/**
 * One sign-in for everyone. The same email and password are tried as a lab user (staff or a B2B client)
 * and, if that doesn't match, as a platform admin, so nobody has to know which door to use.
 * Staff and B2B clients are sent to their own area once signed in (see RedirectIfAuthenticated).
 */
export function LoginForm() {
  const { login } = useAuth();
  const admin = useAdminAuth();
  const router = useRouter();
  const expired = useSearchParams().get("expired") === "1";
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });
  const { errors, isSubmitting } = form.formState;

  // An admin who is already signed in goes straight to the console.
  useEffect(() => {
    if (admin.status === "authenticated") router.replace("/admin");
  }, [admin.status, router]);

  const onSubmit = form.handleSubmit(async (values) => {
    const input = loginSchema.parse(values);
    try {
      await login(input);
      return;
    } catch (err) {
      // Only a plain "no such email or wrong password" is worth trying as an admin;
      // a disabled account, a lockout or a network problem is shown as it is.
      if (!(err instanceof ApiError) || err.status !== 401 || !/incorrect email or password/i.test(err.message)) {
        showFormError(err, form.setError);
        return;
      }
    }
    try {
      const next = await admin.login(input);
      if (next) setMfaToken(next.mfaToken);
      else router.replace("/admin");
    } catch (err) {
      // The same message either way, so the form never says which kind of account an email is.
      if (err instanceof ApiError && err.status === 401) form.setError("root", { message: "Incorrect email or password" });
      else showFormError(err, form.setError);
    }
  });

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setVerifying(true);
    setCodeError(null);
    try {
      await admin.verifyCode(mfaToken!, code);
      router.replace("/admin");
    } catch (err) {
      setCodeError(err instanceof Error ? err.message : "That code didn't work");
      // The ticket lasts 5 minutes; after that, start again with the password.
      if (err instanceof Error && /too long/i.test(err.message)) setMfaToken(null);
    } finally {
      setVerifying(false);
    }
  }

  if (mfaToken) {
    return (
      <form onSubmit={submitCode} noValidate className="flex flex-col gap-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <ShieldCheckIcon className="size-4" /> Two-step sign-in
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Enter your code</h1>
          <p className="text-sm text-muted-foreground">Open your authenticator app and type the 6-digit code. Lost your phone? Use a recovery code.</p>
        </div>
        <FieldGroup>
          <Field data-invalid={!!codeError}>
            <FieldLabel htmlFor="code">Code</FieldLabel>
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              placeholder="123456"
              className="text-center font-mono text-lg tracking-widest"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            {codeError && <p className="text-sm text-destructive">{codeError}</p>}
          </Field>
          <Button type="submit" disabled={verifying || code.trim().length < 6} className="w-full">
            {verifying && <Spinner />}
            Verify
          </Button>
          <Button type="button" variant="ghost" className="w-full" onClick={() => setMfaToken(null)}>
            Back
          </Button>
        </FieldGroup>
      </form>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-sm text-muted-foreground">Lab staff, B2B clients and administrators all sign in here. Enter your email and password.</p>
      </div>

      {expired && (
        <Alert>
          <AlertDescription>Your session ended. Please sign in again.</AlertDescription>
        </Alert>
      )}
      {errors.root && (
        <Alert variant="destructive">
          <AlertDescription>{errors.root.message}</AlertDescription>
        </Alert>
      )}

      <FieldGroup>
        <Field data-invalid={!!errors.email}>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input id="email" type="email" autoComplete="username" autoFocus aria-invalid={!!errors.email} {...form.register("email")} />
          <FieldError errors={[errors.email]} />
        </Field>
        <Field data-invalid={!!errors.password}>
          <div className="flex items-center justify-between">
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <Link href="/forgot-password" className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
              Forgot password?
            </Link>
          </div>
          <Input id="password" type="password" autoComplete="current-password" aria-invalid={!!errors.password} {...form.register("password")} />
          <FieldError errors={[errors.password]} />
        </Field>
        <Button type="submit" disabled={isSubmitting} className="w-full">
          {isSubmitting && <Spinner />}
          Sign in
        </Button>
      </FieldGroup>

      <p className="text-center text-sm text-muted-foreground">
        New lab?{" "}
        <Link href="/signup" className="font-medium text-foreground underline underline-offset-4">
          Create an account
        </Link>
      </p>
    </form>
  );
}
