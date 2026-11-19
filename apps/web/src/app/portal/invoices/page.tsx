"use client";

import { FileTextIcon } from "lucide-react";
import { formatINR } from "@lms/shared";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtIsoDate, useInvoices } from "@/lib/accounts";

export default function PortalInvoices() {
  const { data, isPending } = useInvoices("", "", true);
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Invoices</h1>
      <p className="text-sm text-muted-foreground">Statements of the orders already taken from your wallet. They don&apos;t take any more money.</p>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice no.</TableHead>
              <TableHead>Period</TableHead>
              <TableHead className="text-right">Orders</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending && (
              <TableRow>
                <TableCell colSpan={5}>
                  <Skeleton className="h-5 w-full" />
                </TableCell>
              </TableRow>
            )}
            {data?.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  No invoices yet. The lab raises them for a period, usually monthly.
                </TableCell>
              </TableRow>
            )}
            {data?.map((i) => (
              <TableRow key={i.id}>
                <TableCell className="font-mono text-sm">{i.invoiceNo}</TableCell>
                <TableCell className="whitespace-nowrap text-sm">
                  {fmtIsoDate(i.periodFrom)} – {fmtIsoDate(i.periodTo)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{i.orderCount}</TableCell>
                <TableCell className="text-right tabular-nums">{formatINR(i.totalPaise)}</TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="outline" asChild>
                    <a href={`/print/invoice/${i.id}?portal=1`} target="_blank" rel="noopener noreferrer">
                      <FileTextIcon /> View
                    </a>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
