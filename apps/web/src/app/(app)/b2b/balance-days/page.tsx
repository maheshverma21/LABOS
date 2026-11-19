"use client";

import { DownloadIcon } from "lucide-react";
import { paiseToRupees } from "@lms/shared";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DateRangeInput } from "@/components/filters/date-range-input";
import { Money, formatRupees } from "@/components/b2b/lab-picker";
import { useDateRange } from "@/components/b2b/use-range";
import { fmtIsoDate, useDayBalances } from "@/lib/accounts";
import { downloadCsv } from "@/lib/finance";

/** All labs together, day by day: money in, money out, and the combined wallet balance at the end of the day. */
export default function BalanceDaysPage() {
  const range = useDateRange(29);
  const { data, isPending } = useDayBalances(range);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <DateRangeInput from={range.from} to={range.to} onChange={range.set} />
        <Button
          variant="outline"
          className="ml-auto"
          disabled={!data?.length}
          onClick={() => downloadCsv(`balance-day-wise_${range.from}_to_${range.to}.csv`, ["Date", "Money in", "Money out", "Closing balance"], (data ?? []).map((d) => [d.date, paiseToRupees(d.creditPaise), paiseToRupees(d.debitPaise), paiseToRupees(d.closingPaise)]))}
        >
          <DownloadIcon /> Export
        </Button>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Money in</TableHead>
              <TableHead className="text-right">Money out</TableHead>
              <TableHead className="text-right">Closing balance (all labs)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending && (
              <TableRow>
                <TableCell colSpan={4}>
                  <Skeleton className="h-5 w-full" />
                </TableCell>
              </TableRow>
            )}
            {data?.map((d) => (
              <TableRow key={d.date}>
                <TableCell>{fmtIsoDate(d.date)}</TableCell>
                <TableCell className="text-right tabular-nums">{d.creditPaise ? formatRupees(d.creditPaise) : "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{d.debitPaise ? formatRupees(d.debitPaise) : "—"}</TableCell>
                <TableCell className="text-right">
                  <Money paise={d.closingPaise} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
