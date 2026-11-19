"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LockIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/providers/auth-provider";
import { activeHref, NAV } from "./nav";

/**
 * Pages in the sidebar (and the pages under them) need the same permission as
 * their menu item. Someone who types the address without it gets a plain
 * explanation instead of an empty or half-working page.
 */
export function PageAccess({ children }: { children: React.ReactNode }) {
  const { can } = useAuth();
  const pathname = usePathname();
  const href = activeHref(pathname);
  const item = NAV.flatMap((g) => g.items).find((i) => i.href === href);
  if (!item?.permission || can(item.permission)) return children;
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
      <LockIcon className="size-8 text-muted-foreground" />
      <h1 className="text-xl font-semibold">You don&apos;t have access to {item.title}</h1>
      <p className="text-sm text-muted-foreground">Your role doesn&apos;t include this. If you need it, ask your lab owner to change your role in Users &amp; roles.</p>
      <Button variant="outline" asChild>
        <Link href="/dashboard">Go to the dashboard</Link>
      </Button>
    </div>
  );
}
