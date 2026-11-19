"use client";

import { formatINR } from "@lms/shared";
import type { OrderListItem } from "@lms/shared";
import { DownloadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/app-shell/page-header";
import { RangeFilter, useRange } from "@/components/finance/range-filter";
import { APP_NAME } from "@/lib/brand";
import { downloadCsv, rupees, summarise, useAllOrders } from "@/lib/finance";

function group(orders: OrderListItem[], key: (o: OrderListItem) => string) {
  const m = new Map<string, OrderListItem[]>();
  for (const o of orders) m.set(key(o), [...(m.get(key(o)) ?? []), o]);
  return [...m.entries()].map(([name, rows]) => ({ name, ...summarise(rows) })).sort((a, b) => b.billedPaise - a.billedPaise);
}

function Breakdown({ title, description, label, rows }: { title: string; description: string; label: string; rows: ReturnType<typeof group> }) {
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div className="space-y-1.5">
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <Button variant="outline" size="sm" disabled={!rows.length} onClick={() =>
          downloadCsv(`mis_${title.toLowerCase().replace(/\W+/g, "_")}.csv`, [label, "Bills", "Billed (INR)", "Paid (INR)", "Due (INR)"],
            rows.map((r) => [r.name, r.count, rupees(r.billedPaise), rupees(r.paidPaise), rupees(r.duePaise)]))
        }><DownloadIcon /> CSV</Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{label}</TableHead>
              <TableHead className="text-right">Bills</TableHead>
              <TableHead className="text-right">Billed</TableHead>
              <TableHead className="text-right">Paid</TableHead>
              <TableHead className="text-right">Due</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && <TableRow><TableCell colSpan={5} className="py-6 text-center text-muted-foreground">No data.</TableCell></TableRow>}
            {rows.map((r) => (
              <TableRow key={r.name}>
                <TableCell>{r.name}</TableCell>
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
  );
}

export default function MisReportsPage() {
  const range = useRange();
  const { data, isPending } = useAllOrders(range.from, range.to);

  return (
    <>
      <title>{`MIS reports · ${APP_NAME}`}</title>
      <PageHeader title="MIS reports" description="Business summary by branch, referring doctor and B2B account." />
      <RangeFilter range={range} />
      {isPending || !data ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="grid items-start gap-6 xl:grid-cols-2">
          <Breakdown title="By branch" description="Billing and dues per branch." label="Branch" rows={group(data, (o) => o.branch?.name ?? "—")} />
          <Breakdown title="By referring doctor" description="Business referred by each doctor." label="Doctor" rows={group(data, (o) => o.doctor?.name ?? "Self / no doctor")} />
          <Breakdown title="By B2B account" description="Bills raised against accounts." label="Account" rows={group(data.filter((o) => o.account), (o) => o.account!.name)} />
        </div>
      )}
    </>
  );
}
