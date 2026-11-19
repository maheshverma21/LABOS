"use client";

import { PrinterIcon } from "lucide-react";
import { ageOn, formatAge, SEX_SHORT, todayIST } from "@lms/shared";
import { RequireAuth } from "@/components/auth-guards";
import { Barcode } from "@/components/samples/barcode";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useOrder } from "@/lib/orders";

/**
 * Tube labels, one per page at 50 x 25 mm (the common thermal label size).
 * Only tubes still to be collected are printed.
 */
function Labels({ orderId, all }: { orderId: string; all?: boolean }) {
  const { data: o, error } = useOrder(orderId);
  if (error) return <p className="p-8 text-destructive">{error.message}</p>;
  if (!o) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const seen = new Set<string>();
  // Patient wise tubes share a barcode: one label is enough.
  const samples = o.samples.filter((s) => (all ? s.status !== "CANCELLED" : s.status === "PENDING" || s.status === "COLLECTED") && !seen.has(s.barcode) && !!seen.add(s.barcode));
  const age = formatAge(ageOn(o.patient.dob, todayIST(new Date(o.createdAt))));
  const day = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" }).format(new Date(o.createdAt));

  return (
    <>
      <title>{`Labels ${o.orderNo}`}</title>
      <style>{`@page { size: 50mm 25mm; margin: 0; } @media print { body { margin: 0; } }`}</style>
      <div className="flex items-center justify-between gap-2 p-4 print:hidden">
        <p className="text-sm text-muted-foreground">
          {samples.length} {samples.length === 1 ? "label" : "labels"} for {o.orderNo}. Set the printer to 50 × 25 mm labels.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => window.close()}>
            Close
          </Button>
          <Button onClick={() => window.print()} disabled={!samples.length}>
            <PrinterIcon /> Print
          </Button>
        </div>
      </div>
      {samples.length === 0 && <p className="p-4 text-sm">No tubes to label for this order.</p>}
      <div className="flex flex-wrap gap-3 px-4 print:block print:p-0">
        {samples.map((s) => (
          <div
            key={s.id}
            className="flex h-[25mm] w-[50mm] flex-col justify-between overflow-hidden border bg-white px-[2mm] py-[1.5mm] text-[7pt] leading-tight text-black print:break-after-page print:border-0"
          >
            <div className="flex justify-between gap-1 font-bold">
              <span className="truncate">{o.patient.name}</span>
              <span className="shrink-0">
                {age}/{SEX_SHORT[o.patient.sex]}
              </span>
            </div>
            <div className="flex justify-center">
              <Barcode value={s.barcode} height={28} width={1.2} />
            </div>
            <div className="flex justify-between gap-1">
              <span className="font-mono font-bold">{s.barcode}</span>
              <span>{day}</span>
            </div>
            <div className="truncate">
              {(s.container ?? s.sampleType).split(" (")[0]} · {s.tests.map((t) => t.code).join(" ")}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

export function LabelsPrint({ orderId, all }: { orderId: string; all?: boolean }) {
  return (
    <RequireAuth>
      <Labels orderId={orderId} all={all} />
    </RequireAuth>
  );
}
