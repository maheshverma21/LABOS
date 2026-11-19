"use client";

import { useState } from "react";
import { PrinterIcon } from "lucide-react";
import {
  amountInWords,
  patientDisplayName,
  PAYMENT_MODE_LABEL,
  SEX_LABEL,
  ageOn,
  formatAge,
  todayIST,
} from "@lms/shared";
import { RequireAuth } from "@/components/auth-guards";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { LetterheadToggle, PrintLetterhead, PrintLetterheadFooter } from "@/components/print/letterhead";
import { useBillSettings } from "@/lib/branding";
import { formatDateTime, useOrder } from "@/lib/orders";

function Bill({ id, letterhead: initialLetterhead, portal }: { id: string; letterhead: boolean; portal: boolean }) {
  const { data: o, error } = useOrder(id, portal);
  const [letterhead, setLetterhead] = useState(initialLetterhead);
  const { data: bs } = useBillSettings();
  const custom = bs?.custom ? bs : null;
  if (error) return <p className="p-8 text-destructive">{error.message}</p>;
  if (!o) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const cancelled = o.status === "CANCELLED";
  const payments = o.payments.filter((p) => p.kind === "PAYMENT");

  return (
    <>
      <title>{`Bill ${o.billNo} · ${patientDisplayName(o.patient)}`}</title>
      <div className="mx-auto flex max-w-[210mm] flex-wrap items-center justify-end gap-2 p-4 print:hidden">
        <LetterheadToggle value={letterhead} onChange={setLetterhead} />
        <Button variant="outline" onClick={() => window.close()}>
          Close
        </Button>
        <Button onClick={() => window.print()}>
          <PrinterIcon /> Print
        </Button>
      </div>

      <article
        style={{ fontFamily: '"Times New Roman", Times, "Liberation Serif", serif' }}
        className={`relative mx-auto ${custom?.size === "A5" ? "max-w-[148mm]" : "max-w-[210mm]"} bg-white p-[12mm] text-[11px] leading-tight text-black shadow-sm print:p-0 print:shadow-none`}
      >
        {custom && <style>{`@page { size: ${custom.size}; }`}</style>}
        {cancelled && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="-rotate-12 rounded border-4 border-red-600/60 px-6 py-2 text-5xl font-bold tracking-widest text-red-600/60">
              CANCELLED
            </span>
          </div>
        )}

        <PrintLetterhead bill on={letterhead} title={null}>
          <h1 className="text-xl font-bold">{o.lab.name}</h1>
          {o.branch?.address && <p>{o.branch.address}</p>}
          <p>{[o.branch?.phone ?? o.lab.phone, o.lab.email].filter(Boolean).join(" · ")}</p>
          {o.lab.gstin && <p>GSTIN: {o.lab.gstin}</p>}
        </PrintLetterhead>

        <h2 className="py-1 text-center text-sm font-bold uppercase">{custom ? custom.heading : "Receipt"}</h2>

        <section className="grid grid-cols-[1fr_1.4fr_1fr] gap-x-6 gap-y-1 border-y border-black py-1.5">
          <p>
            <strong>Receipt No.</strong> : {o.billNo}
          </p>
          <p>
            <strong>Name</strong> : <strong>{patientDisplayName(o.patient)} (ID: {o.patient.uhid})</strong>
          </p>
          <p>
            <strong>Sex / Age</strong> : {SEX_LABEL[o.patient.sex]} / {formatAge(ageOn(o.patient.dob, todayIST(new Date(o.createdAt))))}
          </p>
          <p>
            <strong>Payment Mode</strong> : {payments.length ? [...new Set(payments.map((p) => PAYMENT_MODE_LABEL[p.mode]))].join(", ").toUpperCase() : "-"}
          </p>
          <p>
            <strong>Referral</strong> : <strong>{o.doctor ? o.doctor.name.toUpperCase() : "SELF"}</strong>
          </p>
          <p>
            <strong>Date &amp; Time</strong> : {formatDateTime(o.createdAt)}
          </p>
        </section>

        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-black text-left">
              <th className="w-12 py-1">Sr.</th>
              <th className="py-1">Test Name</th>
              <th className="py-1 text-right">Test Price</th>
            </tr>
          </thead>
          <tbody>
            {o.items.map((i, n) => (
              <tr key={i.id}>
                <td className="py-0.5">{n + 1}</td>
                <td className="py-0.5">{i.name}</td>
                <td className="py-0.5 text-right tabular-nums">{(i.pricePaise / 100).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <section className="border-t border-black">
          <div className="flex items-center justify-between gap-6 py-1">
            <p>
              Payable Amount (in words) : <span className="ml-3">{amountInWords(o.netPaise)}</span>
            </p>
            <p className="flex gap-10 tabular-nums">
              <span>Total :</span>
              <span className="w-24 text-right">{(o.grossPaise / 100).toFixed(2)}</span>
            </p>
          </div>
          {o.discountPaise > 0 && (
            <p className="flex justify-end gap-10 pb-1 tabular-nums">
              <span>Discount{o.discountType === "PERCENT" && ` (${o.discountValue}%)`} :</span>
              <span className="w-24 text-right">{(o.discountPaise / 100).toFixed(2)}</span>
            </p>
          )}
          <div className="space-y-1 border-t border-black py-1.5 tabular-nums">
            <p className="flex justify-end gap-10 font-bold">
              <span>Payable Amount :</span>
              <span className="w-24 text-right">{(o.netPaise / 100).toFixed(2)}</span>
            </p>
            <p className="flex justify-end gap-10">
              <span>Total Paid :</span>
              <span className="w-24 text-right">{((cancelled ? 0 : o.paidPaise) / 100).toFixed(2)}</span>
            </p>
            {!cancelled && o.duePaise > 0 && (
              <p className="flex justify-end gap-10">
                <span>Balance Due :</span>
                <span className="w-24 text-right">{(o.duePaise / 100).toFixed(2)}</span>
              </p>
            )}
          </div>
        </section>

        <div className="mt-10 flex justify-end border-t border-black/0">
          <div className="w-[48%] border-t border-black pt-1 text-center">Cashier&apos;s Signature</div>
        </div>
        <PrintLetterheadFooter bill on={letterhead} />
      </article>
    </>
  );
}

export function BillPrint({ id, letterhead, portal }: { id: string; letterhead: boolean; portal: boolean }) {
  return (
    <RequireAuth>
      <div className="min-h-svh bg-muted print:bg-white">
        <Bill id={id} letterhead={letterhead} portal={portal} />
      </div>
    </RequireAuth>
  );
}
