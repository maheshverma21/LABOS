"use client";

import Link from "next/link";
import { useState } from "react";
import { SparklesIcon } from "lucide-react";
import { formatINR, PAYMENT_MODE_LABEL, todayIST } from "@lms/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/app-shell/page-header";
import { RangeFilter, useRange } from "@/components/finance/range-filter";
import { Stat } from "@/components/finance/stat";
import { RevenueChart } from "@/components/finance/revenue-chart";
import { RevenueSources } from "@/components/finance/revenue-sources";
import { useAllOrders, summarise, previousRange, pctChange } from "@/lib/finance";
import { useAuth } from "@/providers/auth-provider";
import { APP_NAME } from "@/lib/brand";
import { useCollections } from "@/lib/orders";
import { formatDate } from "@/lib/patients";

const ALL = "all";

/** Exceptions: cancelled bills plus refunds paid out. */
const exceptions = (c: { orders: { cancelled: number }; payments: { kind: string }[] }) =>
  c.orders.cancelled + c.payments.filter((p) => p.kind === "REFUND").length;

const describe = (p: number | null) => (p == null ? "new activity" : `${p >= 0 ? "up" : "down"} ${Math.abs(p).toFixed(1)}%`);

export default function FinanceDashboardPage() {
  const { user, branch } = useAuth();
  const range = useRange();
  const allBranchAccess = user?.roles.includes("owner") ?? false;
  const [branchId, setBranchId] = useState<string>(branch?.id ?? "");
  const { data, isPending } = useCollections(range.from, range.to, branchId);
  const prev = previousRange(range.from, range.to);
  const { data: prevData } = useCollections(prev.from, prev.to, branchId);
  const { data: orders } = useAllOrders(range.from, range.to);
  const { data: prevOrders } = useAllOrders(prev.from, prev.to);
  const paid = orders ? summarise(orders) : null;
  const isToday = range.from === todayIST() && range.to === todayIST();
  const [insight, setInsight] = useState<string[] | null>(null);

  return (
    <>
      <title>{`Finance dashboard · ${APP_NAME}`}</title>
      <PageHeader
        title="Finance dashboard"
        description={data ? `${range.from === range.to ? formatDate(range.from) : `${formatDate(range.from)} – ${formatDate(range.to)}`} · ${data.branch?.name ?? "All branches"}` : undefined}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <RangeFilter range={range} />
        {(user?.branches.length ?? 0) > 1 && (
          <Select value={branchId || ALL} onValueChange={(v) => setBranchId(v === ALL ? ALL : v)}>
            <SelectTrigger className="w-full sm:w-56" aria-label="Branch">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {allBranchAccess && <SelectItem value={ALL}>All branches</SelectItem>}
              {user?.branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
          </div>
        }
      />

      {isPending || !data ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:max-w-3xl">
            <Stat highlight label={`Total revenue generated${isToday ? " (today)" : ""}`} value={formatINR(data.orders.billedPaise)} hint={`${data.orders.count} bills${data.orders.cancelled ? `, ${data.orders.cancelled} cancelled` : ""}`} delta={prevData ? pctChange(data.orders.billedPaise, prevData.orders.billedPaise) : undefined} />
            <Stat label={`Total collection${isToday ? " (today)" : ""}`} value={formatINR(data.netPaise)} hint={data.refundedPaise ? `after ${formatINR(data.refundedPaise)} refunds` : "Money received, net of refunds"} delta={prevData ? pctChange(data.netPaise, prevData.netPaise) : undefined} />
          </div>

          {paid && (
            <div className="grid gap-3 sm:grid-cols-2 lg:max-w-3xl">
              <Stat label="Doctor commission (payable)" value={formatINR(paid.doctorSharePaise)} hint="Referring doctors' share of billed revenue" />
              <Stat label="Lab share (after commission)" value={formatINR(paid.labSharePaise)} hint="Billed revenue minus doctor commission" />
            </div>
          )}

          <div className="print:hidden">
            <Button variant="ghost" className="text-orange-600" onClick={() => {
              const lines = [
                `Revenue of ${formatINR(data.orders.billedPaise)} across ${data.orders.count} bills${prevData ? ` (${describe(pctChange(data.orders.billedPaise, prevData.orders.billedPaise))} vs the previous period)` : ""}.`,
                `Collected ${formatINR(data.netPaise)}; ${formatINR(data.orders.duePaise)} still pending from patients.`,
              ];
              const top = [...data.byMode].sort((a, b) => b.collectedPaise - a.collectedPaise)[0];
              if (top && top.collectedPaise > 0) lines.push(`${PAYMENT_MODE_LABEL[top.mode]} is the largest payment mode at ${formatINR(top.collectedPaise)}.`);
              if (exceptions(data) > 0) lines.push(`${exceptions(data)} exception(s): cancelled bills or refunds need a look.`);
              if (paid && paid.doctorSharePaise > 0) lines.push(`Doctor commission of ${formatINR(paid.doctorSharePaise)} goes to referring doctors; the lab keeps ${formatINR(paid.labSharePaise)}.`);
              if (data.orders.discountPaise > 0) lines.push(`Discounts given: ${formatINR(data.orders.discountPaise)}.`);
              setInsight(lines);
            }}>
              <SparklesIcon /> Generate insight
            </Button>
            {insight && (
              <ul className="mt-2 list-disc space-y-1 rounded-md border bg-muted/40 p-4 pl-8 text-sm">
                {insight.map((l) => <li key={l}>{l}</li>)}
              </ul>
            )}
          </div>

          <div className="grid items-start gap-6 xl:grid-cols-[1fr_22rem]">
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1.5">
                    <CardTitle>Total revenue generated</CardTitle>
                    <CardDescription>Billing booked during the selected range, split into paid and due business.</CardDescription>
                  </div>
                  <Link href="/finance/bills" className="text-sm text-primary hover:underline">View orders</Link>
                </div>
              </CardHeader>
              <CardContent>{orders ? <RevenueChart orders={orders} from={range.from} to={range.to} /> : <Skeleton className="h-64 w-full" />}</CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Paid vs due revenue</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3">
                <Stat label="Pending business" value={formatINR(paid?.duePaise ?? 0)} />
                <Stat label="Paid business" value={formatINR(paid?.paidPaise ?? 0)} />
              </CardContent>
            </Card>
          </div>

          {orders && <RevenueSources orders={orders} prevOrders={prevOrders} />}
        </>
      )}
    </>
  );
}
