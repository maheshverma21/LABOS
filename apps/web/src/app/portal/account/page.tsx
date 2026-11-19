"use client";

import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChangePasswordForm } from "@/components/auth/change-password-form";
import { changeOwnPassword } from "@/components/auth/must-change-password";
import { useAuth } from "@/providers/auth-provider";

export default function PortalAccount() {
  const { user } = useAuth();
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Change password</CardTitle>
          <CardDescription>
            Signed in as {user?.email}. Other devices are signed out when you change it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm submit={changeOwnPassword} onDone={() => toast.success("Password changed")} />
        </CardContent>
      </Card>
    </>
  );
}
