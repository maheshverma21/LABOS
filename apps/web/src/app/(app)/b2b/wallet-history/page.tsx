"use client";

import { useState } from "react";
import { DownloadIcon } from "lucide-react";
import { paiseToRupees, WALLET_KIND_LABEL, type WalletTxnKind } from "@lms/shared";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { DateRangeInput } from "@/components/filters/date-range-input";
import { LabPicker } from "@/components/b2b/lab-picker";
import { useDateRange } from "@/components/b2b/use-range";
import { WalletTable } from "@/components/b2b/wallet-table";
import { useWalletHistory } from "@/lib/accounts";
import { downloadCsv } from "@/lib/finance";

const ANY = "any";

export default function WalletHistoryPage() {
  const range = useDateRange(6);
  const [labId, setLabId] = useState("");
  const [kind, setKind] = useState<WalletTxnKind | "">("");
  const { data, isPending } = useWalletHistory(range, labId, kind);

  const exportCsv = () =>
    downloadCsv(
      `wallet-history_${range.from}_to_${range.to}.csv`,
      ["Date", "Code", "B2B Lab", "Type", "Details", "Amount", "Balance", "Mode", "Reference"],
      (data?.entries ?? []).map((e) => [e.createdAt, e.account.code, e.account.name, WALLET_KIND_LABEL[e.kind], e.narration ?? "", paiseToRupees(e.amountPaise), paiseToRupees(e.balanceAfterPaise), e.mode ?? "", e.reference ?? ""]),
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <DateRangeInput from={range.from} to={range.to} onChange={range.set} />
        <LabPicker value={labId} onChange={setLabId} allLabel="All B2B labs" />
        <Select value={kind || ANY} onValueChange={(v) => setKind(v === ANY ? "" : (v as WalletTxnKind))}>
          <SelectTrigger className="w-full sm:w-48" aria-label="Entry type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All entries</SelectItem>
            {(Object.keys(WALLET_KIND_LABEL) as WalletTxnKind[]).map((k) => (
              <SelectItem key={k} value={k}>
                {WALLET_KIND_LABEL[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" className="ml-auto" onClick={exportCsv} disabled={!data?.entries.length}>
          <DownloadIcon /> Export
        </Button>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card">
        {isPending ? <Skeleton className="m-4 h-24" /> : <WalletTable entries={data?.entries ?? []} empty="No wallet entries in this period." />}
      </div>
      {data?.truncated && <p className="text-sm text-muted-foreground">Showing the latest 1,000 entries. Narrow the dates or pick a lab to see the rest.</p>}
    </div>
  );
}
