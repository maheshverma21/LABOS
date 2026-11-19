import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminAuthProvider } from "@/providers/admin-auth-provider";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <Suspense>
      {/* Platform admins sign in here too: the form tries lab and B2B accounts first, then admin accounts. */}
      <AdminAuthProvider>
        <LoginForm />
      </AdminAuthProvider>
    </Suspense>
  );
}
