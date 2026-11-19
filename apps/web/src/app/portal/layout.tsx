"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { FlaskConicalIcon, KeyRoundIcon, LogOutIcon } from "lucide-react";
import { RequireAuth } from "@/components/auth-guards";
import { MustChangePassword } from "@/components/auth/must-change-password";
import { ThemeToggle } from "@/components/theme-toggle";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { Money } from "@/components/b2b/lab-picker";
import { useAuth } from "@/providers/auth-provider";
import { usePortalSummary } from "@/lib/portal";
import { APP_NAME } from "@/lib/brand";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/portal", label: "Dashboard" },
  { href: "/portal/new-order", label: "New order" },
  { href: "/portal/orders", label: "Orders & reports" },
  { href: "/portal/wallet", label: "Wallet" },
  { href: "/portal/ledger", label: "Ledger" },
  { href: "/portal/invoices", label: "Invoices" },
  { href: "/portal/rates", label: "My rates" },
];

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <Shell>{children}</Shell>
      <MustChangePassword />
    </RequireAuth>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const { user, can, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const allowed = can("b2b:portal");

  // Lab staff have their own app.
  useEffect(() => {
    if (user && !allowed) router.replace("/dashboard");
  }, [user, allowed, router]);

  if (!user || !allowed) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-svh bg-muted/30">
      <title>{`${user.account?.name ?? "B2B"} · ${APP_NAME}`}</title>
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2">
          <div className="flex items-center gap-2 font-semibold">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <FlaskConicalIcon className="size-4" />
            </div>
            <div className="leading-tight">
              <div>{user.tenant.name}</div>
              <div className="text-xs font-normal text-muted-foreground">B2B portal · {user.account?.name}</div>
            </div>
          </div>
          <WalletChip />
          <ThemeToggle />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50" aria-label="Account menu">
                <Avatar className="size-8">
                  <AvatarFallback>{initials(user.name)}</AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-56">
              <DropdownMenuLabel className="font-normal">
                <div className="font-medium">{user.name}</div>
                <div className="text-xs text-muted-foreground">{user.email}</div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/portal/account">
                  <KeyRoundIcon /> Change password
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void logout()}>
                <LogOutIcon /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <nav aria-label="Portal" className="mx-auto flex max-w-7xl gap-x-5 overflow-x-auto px-4">
          {NAV.map((n) => {
            const active = n.href === "/portal" ? pathname === "/portal" : pathname.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined} className={cn("-mb-px border-b-2 py-2.5 text-sm font-medium whitespace-nowrap", active ? "border-primary text-primary" : "border-transparent text-foreground/80 hover:text-foreground")}>
                {n.label}
              </Link>
            );
          })}
        </nav>
      </header>
      <main className="mx-auto flex max-w-7xl flex-col gap-6 p-4 md:p-6">{children}</main>
    </div>
  );
}

/** The wallet at a glance, so a lab sees what it can still order. */
function WalletChip() {
  const { data } = usePortalSummary();
  if (!data) return null;
  return (
    <Link href="/portal/wallet" className="ml-auto hidden rounded-lg border px-3 py-1 text-xs leading-tight hover:bg-muted sm:block">
      <span className="text-muted-foreground">Net balance</span>
      <div className="text-sm font-semibold">
        <Money paise={data.account.netPaise} />
      </div>
    </Link>
  );
}
