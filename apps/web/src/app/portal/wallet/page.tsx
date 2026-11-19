"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { DateRangeInput } from "@/components/filters/date-range-input";
import { Money } from "@/components/b2b/lab-picker";
import { useDateRange } from "@/components/b2b/use-range";
import { WalletTable } from "@/components/b2b/wallet-table";
import { useWalletHistory } from "@/lib/accounts";
import { usePortalSummary } from "@/lib/portal";

export default function PortalWallet() {
  const range = useDateRange(29);
  const { data: s } = usePortalSummary();
  const { data, isPending } = useWalletHistory(range, "", "", true);
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Wallet</h1>
        {s && (
          <p className="text-sm text-muted-foreground">
            Wallet <Money paise={s.account.walletPaise} className="font-medium text-foreground" /> · on hold <Money paise={s.account.holdPaise} className="font-medium text-foreground" /> · net{" "}
            <Money paise={s.account.netPaise} className="font-medium text-foreground" />
          </p>
        )}
      </div>
      <p className="text-sm text-muted-foreground">Money you pay the lab is added here. Each order is held when you place it and taken when the lab receives the sample.</p>
      <DateRangeInput from={range.from} to={range.to} onChange={range.set} />
      <div className="overflow-x-auto rounded-xl border bg-card">
        {isPending ? <Skeleton className="m-4 h-24" /> : <WalletTable showLab={false} entries={data?.entries ?? []} empty="No wallet entries in this period." />}
      </div>
    </>
  );
}
