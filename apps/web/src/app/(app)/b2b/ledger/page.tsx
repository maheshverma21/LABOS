"use client";

import { useState } from "react";
import { DownloadIcon, PrinterIcon } from "lucide-react";
import { paiseToRupees, WALLET_KIND_LABEL } from "@lms/shared";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DateRangeInput } from "@/components/filters/date-range-input";
import { LabPicker } from "@/components/b2b/lab-picker";
import { LedgerView } from "@/components/b2b/ledger-view";
import { useDateRange } from "@/components/b2b/use-range";
import { useLedger } from "@/lib/accounts";
import { downloadCsv } from "@/lib/finance";

export default function LedgerPage() {
  const range = useDateRange(29);
  const [labId, setLabId] = useState("");
  const { data, isPending } = useLedger(range, labId);

  const exportCsv = () =>
    data &&
    downloadCsv(
      `ledger_${data.account.code}_${range.from}_to_${range.to}.csv`,
      ["Date", "Type", "Details", "Credit", "Debit", "Balance"],
      [
        ["", "Opening balance", "", "", "", paiseToRupees(data.openingPaise)],
        ...data.entries.map((e) => [e.createdAt, WALLET_KIND_LABEL[e.kind], e.narration ?? "", e.amountPaise > 0 ? paiseToRupees(e.amountPaise) : "", e.amountPaise < 0 ? paiseToRupees(-e.amountPaise) : "", paiseToRupees(e.balanceAfterPaise)]),
        ["", "Closing balance", "", paiseToRupees(data.creditPaise), paiseToRupees(data.debitPaise), paiseToRupees(data.closingPaise)],
      ],
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <LabPicker value={labId} onChange={setLabId} />
        <DateRangeInput from={range.from} to={range.to} onChange={range.set} />
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={exportCsv} disabled={!data}>
            <DownloadIcon /> Export
          </Button>
          <Button variant="outline" onClick={() => window.print()} disabled={!data}>
            <PrinterIcon /> Print
          </Button>
        </div>
      </div>
      {!labId ? (
        <p className="rounded-xl border bg-card p-10 text-center text-muted-foreground">Pick a B2B lab to see its ledger.</p>
      ) : isPending || !data ? (
        <Skeleton className="h-40" />
      ) : (
        <LedgerView ledger={data} />
      )}
    </div>
  );
}
