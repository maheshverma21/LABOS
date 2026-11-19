"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ExternalLinkIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AddMoneyDialog } from "@/components/b2b/add-money-dialog";
import { useAuth } from "@/providers/auth-provider";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/b2b", label: "B2B Labs" },
  { href: "/b2b/wallet-history", label: "Wallet History" },
  { href: "/b2b/ledger", label: "Ledger" },
  { href: "/b2b/invoices", label: "Invoices" },
  { href: "/b2b/balance-days", label: "Balance (Day Wise)" },
  { href: "/b2b/balance-labs", label: "Balance (B2B Wise)" },
  { href: "/b2b/notes", label: "Credit/Debit Note" },
];

export default function B2BLayout({ children }: { children: React.ReactNode }) {
  const { can } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [dialog, setDialog] = useState<"money" | null>(null);
  const write = can("accounts:write");

  // Adding or editing a lab is a page of its own, without the tabs.
  if (pathname.startsWith("/b2b/lab")) return <>{children}</>;

  return (
    <>
      <title>B2B Labs · LabOS</title>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b">
        <nav aria-label="B2B sections" className="-mb-px flex flex-wrap gap-x-5">
          {TABS.map((t) => {
            const active = t.href === "/b2b" ? pathname === "/b2b" : pathname.startsWith(t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={cn("border-b-2 py-3 text-sm font-medium whitespace-nowrap", active ? "border-primary text-primary" : "border-transparent text-foreground/80 hover:text-foreground")}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex flex-wrap gap-2 pb-2">
          <Button asChild>
            <a href="https://dashboard.razorpay.com" target="_blank" rel="noopener noreferrer">
              Razorpay Dashboard <ExternalLinkIcon />
            </a>
          </Button>
          {write && (
            <>
              <Button onClick={() => setDialog("money")}>Add Money</Button>
              <Button onClick={() => router.push("/b2b/lab/new")}>
                <PlusIcon /> New B2B Lab
              </Button>
            </>
          )}
        </div>
      </div>
      {children}
      {dialog === "money" && <AddMoneyDialog onClose={() => setDialog(null)} />}
    </>
  );
}
