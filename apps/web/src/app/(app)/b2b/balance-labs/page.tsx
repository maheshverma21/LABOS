"use client";

import { useDeferredValue, useState } from "react";
import { DownloadIcon, SearchIcon } from "lucide-react";
import { paiseToRupees } from "@lms/shared";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DateRangeInput } from "@/components/filters/date-range-input";
import { Money, formatRupees } from "@/components/b2b/lab-picker";
import { useDateRange } from "@/components/b2b/use-range";
import { useLabBalances } from "@/lib/accounts";
import { downloadCsv } from "@/lib/finance";

/** Each lab's wallet over a period: where it started, what came in and went out, and where it ended. */
export default function BalanceLabsPage() {
  const range = useDateRange(29);
  const [search, setSearch] = useState("");
  const q = useDeferredValue(search.trim().toLowerCase());
  const { data, isPending } = useLabBalances(range);
  const rows = (data ?? []).filter((r) => !q || r.account.name.toLowerCase().includes(q) || r.account.code.toLowerCase().includes(q));
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((t, r) => t + f(r), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <DateRangeInput from={range.from} to={range.to} onChange={range.set} />
        <InputGroup className="w-full sm:w-64">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput placeholder="Search by B2B Client or Code" aria-label="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
        </InputGroup>
        <Button
          variant="outline"
          className="ml-auto"
          disabled={!rows.length}
          onClick={() =>
            downloadCsv(`balance-lab-wise_${range.from}_to_${range.to}.csv`, ["Code", "B2B Lab", "Opening", "Money in", "Money out", "Closing", "On hold"], rows.map((r) => [r.account.code, r.account.name, paiseToRupees(r.openingPaise), paiseToRupees(r.creditPaise), paiseToRupees(r.debitPaise), paiseToRupees(r.closingPaise), paiseToRupees(r.holdPaise)]))
          }
        >
          <DownloadIcon /> Export
        </Button>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>B2B Lab</TableHead>
              <TableHead className="text-right">Opening</TableHead>
              <TableHead className="text-right">Money in</TableHead>
              <TableHead className="text-right">Money out</TableHead>
              <TableHead className="text-right">Closing</TableHead>
              <TableHead className="text-right">On hold now</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending && (
              <TableRow>
                <TableCell colSpan={6}>
                  <Skeleton className="h-5 w-full" />
                </TableCell>
              </TableRow>
            )}
            {data && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  No B2B labs.
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.account.id}>
                <TableCell>
                  <div className="font-medium">{r.account.name}</div>
                  <div className="text-sm text-muted-foreground">{r.account.code}</div>
                </TableCell>
                <TableCell className="text-right">
                  <Money paise={r.openingPaise} />
                </TableCell>
                <TableCell className="text-right tabular-nums">{r.creditPaise ? formatRupees(r.creditPaise) : "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{r.debitPaise ? formatRupees(r.debitPaise) : "—"}</TableCell>
                <TableCell className="text-right font-medium">
                  <Money paise={r.closingPaise} />
                </TableCell>
                <TableCell className="text-right tabular-nums">{r.holdPaise ? formatRupees(r.holdPaise) : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          {rows.length > 0 && (
            <TableFooter>
              <TableRow className="font-semibold">
                <TableCell>Total</TableCell>
                <TableCell className="text-right">
                  <Money paise={sum((r) => r.openingPaise)} />
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatRupees(sum((r) => r.creditPaise))}</TableCell>
                <TableCell className="text-right tabular-nums">{formatRupees(sum((r) => r.debitPaise))}</TableCell>
                <TableCell className="text-right">
                  <Money paise={sum((r) => r.closingPaise)} />
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatRupees(sum((r) => r.holdPaise))}</TableCell>
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </div>
    </div>
  );
}
