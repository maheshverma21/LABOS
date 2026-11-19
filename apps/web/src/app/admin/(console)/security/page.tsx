"use client";

import { toast } from "sonner";
import { ShieldCheckIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/app-shell/page-header";
import { ChangePasswordForm } from "@/components/auth/change-password-form";
import { MfaSetup } from "@/components/admin/mfa-setup";
import { useAdminAuth } from "@/providers/admin-auth-provider";
import { adminApi } from "@/lib/admin-api";

export default function AdminSecurityPage() {
  const { admin } = useAdminAuth();
  return (
    <>
      <title>Security · Platform admin</title>
      <PageHeader title="Security" description="Your password and two-step sign-in." />
      {admin?.mfaEnabled ? (
        <Card className="max-w-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheckIcon className="size-5 text-emerald-600" /> Two-step sign-in is on
            </CardTitle>
            <CardDescription>
              You sign in with your password and a code from your authenticator app. Lost your phone and recovery codes? Ask another super admin to
              reset it from Admins.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <MfaSetup />
      )}
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Password</CardTitle>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm
            minLength={12}
            submit={(v) => adminApi("/auth/change-password", { method: "POST", body: v })}
            onDone={() => toast.success("Password changed. Your other sessions were signed out.")}
          />
        </CardContent>
      </Card>
    </>
  );
}
