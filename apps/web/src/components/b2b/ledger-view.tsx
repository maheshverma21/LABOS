"use client";

import { WALLET_KIND_LABEL, type LedgerResponse } from "@lms/shared";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtIsoDate, fmtStamp } from "@/lib/accounts";
import { Money, formatRupees } from "./lab-picker";

/** A lab's statement: opening balance, every entry with the running balance, then totals and the closing balance. */
export function LedgerView({ ledger: l }: { ledger: LedgerResponse }) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <div className="border-b p-4">
        <div className="font-semibold">{l.account.name}</div>
        <div className="text-sm text-muted-foreground">
          {l.account.code} · {fmtIsoDate(l.from)} to {fmtIsoDate(l.to)}
        </div>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Details</TableHead>
            <TableHead className="text-right">Credit</TableHead>
            <TableHead className="text-right">Debit</TableHead>
            <TableHead className="text-right">Balance</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow className="bg-muted/40 font-medium">
            <TableCell colSpan={5}>Opening balance</TableCell>
            <TableCell className="text-right">
              <Money paise={l.openingPaise} />
            </TableCell>
          </TableRow>
          {l.entries.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                No entries in this period.
              </TableCell>
            </TableRow>
          )}
          {l.entries.map((e) => (
            <TableRow key={e.id}>
              <TableCell className="whitespace-nowrap">{fmtStamp(e.createdAt)}</TableCell>
              <TableCell>{WALLET_KIND_LABEL[e.kind]}</TableCell>
              <TableCell className="max-w-72 truncate text-sm">{e.narration ?? (e.orderNo ? `Order ${e.orderNo}` : "")}</TableCell>
              <TableCell className="text-right tabular-nums">{e.amountPaise > 0 ? formatRupees(e.amountPaise) : ""}</TableCell>
              <TableCell className="text-right tabular-nums">{e.amountPaise < 0 ? formatRupees(-e.amountPaise) : ""}</TableCell>
              <TableCell className="text-right">
                <Money paise={e.balanceAfterPaise} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow className="font-semibold">
            <TableCell colSpan={3}>Closing balance</TableCell>
            <TableCell className="text-right tabular-nums">{formatRupees(l.creditPaise)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatRupees(l.debitPaise)}</TableCell>
            <TableCell className="text-right">
              <Money paise={l.closingPaise} />
            </TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}
