"use client";

import Link from "next/link";
import { useState } from "react";
import { formatINR } from "@lms/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/app-shell/page-header";
import { RangeFilter, useRange } from "@/components/finance/range-filter";
import { APP_NAME } from "@/lib/brand";
import { formatDateTime, PAYMENT_STATUS_LABEL, useOrders } from "@/lib/orders";

const PAGE_SIZE = 25;

export default function BillListPage() {
  const range = useRange();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"" | "due" | "cancelled">("");
  const [page, setPage] = useState(1);
  const { data, isPending } = useOrders({ q, date: range.from, dateTo: range.to, status, page, pageSize: PAGE_SIZE });
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <>
      <title>{`Bill list · ${APP_NAME}`}</title>
      <PageHeader title="Bill list" description="Every bill raised in the selected period." />
      <div className="flex flex-wrap items-center gap-3">
        <RangeFilter range={{ ...range, set: (f, t) => { range.set(f, t); setPage(1); } }} />
        <Input className="w-full sm:w-64" placeholder="Search bill no., patient, phone" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <Select value={status || "all"} onValueChange={(v) => { setStatus(v === "all" ? "" : (v as "due" | "cancelled")); setPage(1); }}>
          <SelectTrigger className="w-full sm:w-40" aria-label="Status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All bills</SelectItem>
            <SelectItem value="due">With dues</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent>
          {isPending || !data ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bill no.</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Patient</TableHead>
                  <TableHead className="hidden lg:table-cell">Billed to</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Due</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.orders.length === 0 && (
                  <TableRow><TableCell colSpan={8} className="py-6 text-center text-muted-foreground">No bills in this period.</TableCell></TableRow>
                )}
                {data.orders.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell><Link href={`/orders/${o.id}`} className="font-mono text-xs hover:underline">{o.billNo || o.orderNo}</Link></TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(o.createdAt)}</TableCell>
                    <TableCell>{o.patient.name}<span className="block text-xs text-muted-foreground">{o.patient.uhid}</span></TableCell>
                    <TableCell className="hidden lg:table-cell text-muted-foreground">{o.account?.name ?? "Patient"}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatINR(o.netPaise)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatINR(o.paidPaise)}</TableCell>
                    <TableCell className="text-right tabular-nums">{o.status === "ACTIVE" && !o.account ? formatINR(o.duePaise) : "—"}</TableCell>
                    <TableCell>{PAYMENT_STATUS_LABEL[o.paymentStatus]}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {data && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{data.total} bills</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
            <span>Page {page} of {pages}</span>
            <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        </div>
      )}
    </>
  );
}
