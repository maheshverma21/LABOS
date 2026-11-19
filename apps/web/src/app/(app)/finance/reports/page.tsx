"use client";

import { formatINR, PAYMENT_MODE_LABEL } from "@lms/shared";
import { DownloadIcon, PrinterIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/app-shell/page-header";
import { RangeFilter, useRange } from "@/components/finance/range-filter";
import { Stat } from "@/components/finance/stat";
import { useAuth } from "@/providers/auth-provider";
import { APP_NAME } from "@/lib/brand";
import { downloadCsv, rupees, summarise, useAllOrders } from "@/lib/finance";
import { formatDay, useCollections } from "@/lib/orders";

export default function FinancialReportsPage() {
  const { branch } = useAuth();
  const range = useRange();
  const orders = useAllOrders(range.from, range.to);
  const coll = useCollections(range.from, range.to, branch?.id ?? "");
  const ready = orders.data && coll.data;

  const days = new Map<string, NonNullable<typeof orders.data>>();
  for (const o of orders.data ?? []) {
    const d = o.createdAt.slice(0, 10);
    days.set(d, [...(days.get(d) ?? []), o]);
  }
  const daily = [...days.entries()].sort(([a], [b]) => (a < b ? 1 : -1)).map(([d, rows]) => ({ d, ...summarise(rows) }));
  const total = summarise(orders.data ?? []);

  return (
    <>
      <title>{`Financial reports · ${APP_NAME}`}</title>
      <PageHeader
        title="Financial reports"
        description="Revenue, collections and outstanding dues."
        actions={
          <>
            <Button variant="outline" className="print:hidden" disabled={!daily.length} onClick={() =>
              downloadCsv(`financial_${range.from}_to_${range.to}.csv`, ["Day", "Bills", "Billed (INR)", "Paid (INR)", "Due (INR)", "Billed to accounts (INR)"],
                daily.map((r) => [r.d, r.count, rupees(r.billedPaise), rupees(r.paidPaise), rupees(r.duePaise), rupees(r.onAccountPaise)]))
            }><DownloadIcon /> CSV</Button>
            <Button variant="outline" className="print:hidden" onClick={() => window.print()}><PrinterIcon /> Print</Button>
          </>
        }
      />
      <div className="print:hidden"><RangeFilter range={range} /></div>

      {!ready ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Revenue (billed)" value={formatINR(total.billedPaise)} strong hint={`${total.count} bills`} />
            <Stat label="Collected (net of refunds)" value={formatINR(coll.data!.netPaise)} strong />
            <Stat label="Outstanding from patients" value={formatINR(total.duePaise)} />
            <Stat label="Billed to B2B accounts" value={formatINR(total.onAccountPaise)} />
          </div>
          <div className="grid items-start gap-6 xl:grid-cols-[1fr_24rem]">
            <Card>
              <CardHeader><CardTitle>Day by day</CardTitle><CardDescription>Bills raised on each day (cancelled bills excluded).</CardDescription></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Day</TableHead>
                      <TableHead className="text-right">Bills</TableHead>
                      <TableHead className="text-right">Billed</TableHead>
                      <TableHead className="text-right">Paid</TableHead>
                      <TableHead className="text-right">Due</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {daily.length === 0 && <TableRow><TableCell colSpan={5} className="py-6 text-center text-muted-foreground">No bills in this period.</TableCell></TableRow>}
                    {daily.map((r) => (
                      <TableRow key={r.d}>
                        <TableCell>{formatDay(`${r.d}T12:00:00+05:30`)}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.count}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatINR(r.billedPaise)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatINR(r.paidPaise)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatINR(r.duePaise)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Collections by mode</CardTitle><CardDescription>Current branch, net of refunds.</CardDescription></CardHeader>
              <CardContent>
                <Table>
                  <TableBody>
                    {coll.data!.byMode.map((m) => (
                      <TableRow key={m.mode}>
                        <TableCell>{PAYMENT_MODE_LABEL[m.mode]}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatINR(m.collectedPaise - m.refundedPaise)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </>
  );
}
