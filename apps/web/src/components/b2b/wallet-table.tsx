"use client";

import { WALLET_KIND_LABEL, PAYMENT_MODE_LABEL, type WalletTxnItem } from "@lms/shared";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtStamp } from "@/lib/accounts";
import { Money } from "./lab-picker";

/** Wallet entries: money in green with a plus, money out with a minus, and the balance after each. */
export function WalletTable({ entries, showLab = true, empty }: { entries: WalletTxnItem[]; showLab?: boolean; empty: string }) {
  const cols = showLab ? 7 : 6;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          {showLab && <TableHead>B2B Lab</TableHead>}
          <TableHead>Type</TableHead>
          <TableHead>Details</TableHead>
          <TableHead className="text-right">Amount</TableHead>
          <TableHead className="text-right">Balance</TableHead>
          <TableHead>Reference</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.length === 0 && (
          <TableRow>
            <TableCell colSpan={cols} className="py-10 text-center text-muted-foreground">
              {empty}
            </TableCell>
          </TableRow>
        )}
        {entries.map((e) => (
          <TableRow key={e.id}>
            <TableCell className="whitespace-nowrap">{fmtStamp(e.createdAt)}</TableCell>
            {showLab && (
              <TableCell>
                <div className="font-medium">{e.account.name}</div>
                <div className="text-xs text-muted-foreground">{e.account.code}</div>
              </TableCell>
            )}
            <TableCell>
              <Badge variant={e.amountPaise > 0 ? "secondary" : "outline"}>{WALLET_KIND_LABEL[e.kind]}</Badge>
            </TableCell>
            <TableCell className="max-w-72 truncate text-sm" title={e.narration ?? undefined}>
              {e.narration ?? (e.orderNo ? `Order ${e.orderNo}` : "")}
            </TableCell>
            <TableCell className={`text-right font-medium tabular-nums ${e.amountPaise > 0 ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
              {e.amountPaise > 0 ? "+" : "−"}₹{Math.abs(e.amountPaise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}
            </TableCell>
            <TableCell className="text-right">
              <Money paise={e.balanceAfterPaise} />
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">{[e.mode ? PAYMENT_MODE_LABEL[e.mode] : null, e.reference].filter(Boolean).join(" · ")}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
