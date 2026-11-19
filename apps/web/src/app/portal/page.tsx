"use client";

import Link from "next/link";
import { AlertTriangleIcon, ClipboardListIcon, PlusIcon } from "lucide-react";
import { formatINR } from "@lms/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Money } from "@/components/b2b/lab-picker";
import { useDateRange } from "@/components/b2b/use-range";
import { OrdersTable } from "./orders/orders-table";
import { useAuth } from "@/providers/auth-provider";
import { usePortalOrders, usePortalSummary } from "@/lib/portal";

function Stat({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold">{children}</div>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export default function PortalHome() {
  const { user } = useAuth();
  const { data: s, isPending } = usePortalSummary();
  const range = useDateRange(6);
  const recent = usePortalOrders(range.from, range.to, "");

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Hello, {user?.name.split(" ")[0]}</h1>
          <p className="text-sm text-muted-foreground">{user?.account?.name}: place orders, track samples and download reports.</p>
        </div>
        <Button asChild>
          <Link href="/portal/new-order">
            <PlusIcon /> New order
          </Link>
        </Button>
      </div>

      {isPending || !s ? (
        <Skeleton className="h-28" />
      ) : (
        <>
          {s.availablePaise != null && s.availablePaise <= 0 && (
            <Alert variant="destructive">
              <AlertTriangleIcon />
              <AlertDescription>Your wallet has reached its limit, so new orders will be refused. Please add money by paying the lab, then it appears here.</AlertDescription>
            </Alert>
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Wallet balance" hint="Money paid in, less samples received">
              <Money paise={s.account.walletPaise} />
            </Stat>
            <Stat label="On hold" hint="Orders whose sample the lab hasn't received yet">
              {formatINR(s.account.holdPaise)}
            </Stat>
            <Stat label="Net balance" hint={s.account.creditLimitPaise == null ? "No credit limit" : `Credit limit ${formatINR(s.account.creditLimitPaise)}`}>
              <Money paise={s.account.netPaise} />
            </Stat>
            <Stat label="Available to order" hint="Net balance plus your credit">
              {s.availablePaise == null ? "No limit" : formatINR(Math.max(s.availablePaise, 0))}
            </Stat>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="Orders today">{s.orders.today}</Stat>
            <Stat label="Reports pending" hint="Orders from the last 30 days">
              {s.orders.pendingReports}
            </Stat>
            <Stat label="Reports ready" hint="Orders from the last 30 days">
              {s.orders.ready}
            </Stat>
          </div>
        </>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-semibold">
            <ClipboardListIcon className="size-4" /> This week&apos;s orders
          </h2>
          <Link href="/portal/orders" className="text-sm text-primary hover:underline">
            All orders
          </Link>
        </div>
        <div className="overflow-x-auto rounded-xl border bg-card">
          <OrdersTable orders={(recent.data ?? []).slice(0, 8)} loading={recent.isPending} />
        </div>
      </section>
    </>
  );
}
