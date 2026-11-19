"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Building2Icon, KeyRoundIcon, LayoutDashboardIcon, LogOutIcon, ScrollTextIcon, ShieldCheckIcon, UserCogIcon, UsersIcon } from "lucide-react";
import { PLATFORM_ROLE_LABEL } from "@lms/shared";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useAdminAuth } from "@/providers/admin-auth-provider";
import { APP_NAME } from "@/lib/brand";
import { cn } from "@/lib/utils";
import { MfaSetup } from "./mfa-setup";
import { ThemeToggle } from "@/components/theme-toggle";

const NAV = [
  { href: "/admin", title: "Overview", icon: LayoutDashboardIcon, exact: true },
  { href: "/admin/labs", title: "Labs", icon: Building2Icon },
  { href: "/admin/users", title: "Users", icon: UsersIcon },
  { href: "/admin/audit", title: "Audit log", icon: ScrollTextIcon },
  { href: "/admin/admins", title: "Admins", icon: UserCogIcon, superOnly: true },
  { href: "/admin/security", title: "Security", icon: KeyRoundIcon },
];

/** The platform admin console's frame: a dark top bar so it's never mistaken for a lab's app. */
export function AdminShell({ children }: { children: React.ReactNode }) {
  const { status, admin, isSuper, logout } = useAdminAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
  }, [status, router]);

  if (status !== "authenticated" || !admin) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    );
  }

  // Two-step sign-in required but not set up: the setup is the only thing on offer.
  const setupFirst = admin.mfaRequired && !admin.mfaEnabled;
  const items = setupFirst ? [] : NAV.filter((i) => !i.superOnly || isSuper);
  const isActive = (href: string, exact?: boolean) => (exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));

  return (
    <div className="min-h-svh bg-muted/30">
      <header className="sticky top-0 z-20 bg-sidebar text-sidebar-foreground border-b border-sidebar-border">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
          <Link href="/admin" className="flex items-center gap-2 font-semibold">
            <ShieldCheckIcon className="size-5 text-sidebar-primary" />
            <span>{APP_NAME}</span>
            <span className="rounded bg-sidebar-primary/15 px-1.5 py-0.5 text-xs font-medium whitespace-nowrap text-sidebar-primary">Platform admin</span>
          </Link>
          <nav className="ml-4 hidden items-center gap-1 lg:flex">
            {items.map((i) => (
              <Link
                key={i.href}
                href={i.href}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm whitespace-nowrap",
                  isActive(i.href, i.exact) ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/70 hover:text-sidebar-foreground",
                )}
              >
                <i.icon className="size-4" /> {i.title}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right text-xs leading-tight sm:block">
              <div className="font-medium">{admin.name}</div>
              <div className="text-sidebar-foreground/70">{PLATFORM_ROLE_LABEL[admin.role]}</div>
            </div>
            <ThemeToggle className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" />
            <Button variant="ghost" size="sm" className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" onClick={logout}>
              <LogOutIcon /> Sign out
            </Button>
          </div>
        </div>
        {/* Phones and tablets: the nav scrolls sideways under the bar. */}
        <nav className="flex gap-1 overflow-x-auto px-4 pb-2 lg:hidden">
          {items.map((i) => (
            <Link
              key={i.href}
              href={i.href}
              className={cn(
                "shrink-0 rounded-md px-3 py-1.5 text-sm",
                isActive(i.href, i.exact) ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/70",
              )}
            >
              {i.title}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto flex max-w-7xl flex-col gap-6 p-4 md:p-6">{setupFirst ? <MfaSetup forced /> : children}</main>
    </div>
  );
}
