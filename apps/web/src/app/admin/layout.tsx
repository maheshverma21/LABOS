import type { Metadata } from "next";
import { AdminAuthProvider } from "@/providers/admin-auth-provider";

export const metadata: Metadata = {
  title: { default: "Platform admin", template: "%s · Platform admin" },
  robots: { index: false, follow: false },
};

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return <AdminAuthProvider>{children}</AdminAuthProvider>;
}
