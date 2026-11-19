"use client";

import { PrinterIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DateRangeInput } from "@/components/filters/date-range-input";
import { LedgerView } from "@/components/b2b/ledger-view";
import { useDateRange } from "@/components/b2b/use-range";
import { useLedger } from "@/lib/accounts";

export default function PortalLedger() {
  const range = useDateRange(29);
  const { data } = useLedger(range, "", true);
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight print:hidden">Ledger</h1>
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <DateRangeInput from={range.from} to={range.to} onChange={range.set} />
        <Button variant="outline" className="ml-auto" onClick={() => window.print()} disabled={!data}>
          <PrinterIcon /> Print
        </Button>
      </div>
      {data ? <LedgerView ledger={data} /> : <Skeleton className="h-40" />}
    </>
  );
}
