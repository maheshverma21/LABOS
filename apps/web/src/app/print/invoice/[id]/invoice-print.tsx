"use client";

import { useState } from "react";
import { PrinterIcon } from "lucide-react";
import { amountInWords, formatINR } from "@lms/shared";
import { RequireAuth } from "@/components/auth-guards";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { LetterheadToggle, PrintLetterhead, PrintLetterheadFooter } from "@/components/print/letterhead";
import { fmtIsoDate, useInvoice } from "@/lib/accounts";

const istDay = (iso: string) => fmtIsoDate(new Date(new Date(iso).getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10));

function Invoice({ id, letterhead: initialLetterhead, portal }: { id: string; letterhead: boolean; portal: boolean }) {
  const { data: inv, error } = useInvoice(id, portal);
  const [letterhead, setLetterhead] = useState(initialLetterhead);
  if (error) return <p className="p-8 text-destructive">{error.message}</p>;
  if (!inv) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <>
      <title>{`Invoice ${inv.invoiceNo} · ${inv.account.name}`}</title>
      <div className="mx-auto flex max-w-[210mm] flex-wrap items-center justify-end gap-2 p-4 print:hidden">
        <LetterheadToggle value={letterhead} onChange={setLetterhead} />
        <Button variant="outline" onClick={() => window.close()}>
          Close
        </Button>
        <Button onClick={() => window.print()}>
          <PrinterIcon /> Print
        </Button>
      </div>

      <article className="relative mx-auto max-w-[210mm] bg-white p-[12mm] text-[13px] leading-snug text-black shadow-sm print:p-0 print:shadow-none">
        {inv.status === "VOID" && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="-rotate-12 rounded border-4 border-red-600/60 px-6 py-2 text-5xl font-bold tracking-widest text-red-600/60">VOID</span>
          </div>
        )}
        <PrintLetterhead
          on={letterhead}
          title={
            <>
              <p className="text-base font-bold tracking-wide">INVOICE (BILL OF SUPPLY)</p>
              <p className="text-[11px]">Healthcare services: exempt from GST</p>
              {!letterhead && inv.lab.gstin && <p className="text-[11px]">GSTIN: {inv.lab.gstin}</p>}
            </>
          }
        >
          <h1 className="text-2xl font-bold">{inv.lab.name}</h1>
          <p>{[inv.lab.phone, inv.lab.email].filter(Boolean).join(" · ")}</p>
          {inv.lab.gstin && <p>GSTIN: {inv.lab.gstin}</p>}
        </PrintLetterhead>

        <section className="grid grid-cols-2 gap-x-8 border-b py-3">
          <div className="space-y-0.5">
            <p className="text-neutral-500">Bill to</p>
            <p className="font-bold">{inv.account.name}</p>
            {inv.account.contactName && <p>Attn: {inv.account.contactName}</p>}
            {inv.account.address && <p>{inv.account.address}</p>}
            {inv.account.gstin && <p>GSTIN: {inv.account.gstin}</p>}
          </div>
          <div className="space-y-0.5 text-right">
            <p>
              <span className="text-neutral-500">Invoice no.:</span> <strong>{inv.invoiceNo}</strong>
            </p>
            <p>
              <span className="text-neutral-500">Date:</span> {istDay(inv.issuedAt)}
            </p>
            <p>
              <span className="text-neutral-500">Period:</span> {fmtIsoDate(inv.periodFrom)} to {fmtIsoDate(inv.periodTo)}
            </p>
            <p>
              <span className="text-neutral-500">Account code:</span> {inv.account.code}
            </p>
          </div>
        </section>

        <table className="mt-3 w-full border-collapse">
          <thead>
            <tr className="border-b border-black text-left">
              <th className="py-1 pr-2 font-semibold">#</th>
              <th className="py-1 pr-2 font-semibold">Date</th>
              <th className="py-1 pr-2 font-semibold">Lab no.</th>
              <th className="py-1 pr-2 font-semibold">Patient</th>
              <th className="py-1 pr-2 font-semibold">Tests</th>
              <th className="py-1 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {inv.orders.map((o, i) => (
              <tr key={o.id} className="border-b border-neutral-200 align-top">
                <td className="py-1 pr-2">{i + 1}</td>
                <td className="py-1 pr-2 whitespace-nowrap">{istDay(o.createdAt)}</td>
                <td className="py-1 pr-2 font-mono text-[12px]">{o.orderNo}</td>
                <td className="py-1 pr-2">
                  {o.patient.name} <span className="text-neutral-500">({o.patient.uhid})</span>
                </td>
                <td className="py-1 pr-2">{o.tests.join(", ")}</td>
                <td className="py-1 text-right tabular-nums">{formatINR(o.netPaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-3 flex justify-end">
          <table className="w-64 tabular-nums">
            <tbody>
              <tr className="border-t border-black font-bold">
                <td className="py-1">Total ({inv.orders.length} orders)</td>
                <td className="py-1 text-right">{formatINR(inv.totalPaise)}</td>
              </tr>
              <tr className="font-semibold">
                <td className="py-0.5">Paid from wallet</td>
                <td className="py-0.5 text-right">{formatINR(inv.totalPaise)}</td>
              </tr>
              <tr className="font-semibold">
                <td className="py-0.5">Balance due</td>
                <td className="py-0.5 text-right">{formatINR(0)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2">
          <span className="text-neutral-500">Amount in words:</span> {amountInWords(inv.totalPaise)}
        </p>

        <footer className="mt-10 flex items-end justify-between text-[11px] text-neutral-600">
          <p>Statement of orders already settled from your prepaid wallet.</p>
          <p className="text-right">
            For {inv.lab.name}
            <br />
            <br />
            Authorised signatory
          </p>
        </footer>
        <PrintLetterheadFooter on={letterhead} />
      </article>
    </>
  );
}

export function InvoicePrint({ id, letterhead, portal }: { id: string; letterhead: boolean; portal: boolean }) {
  return (
    <RequireAuth>
      <Invoice id={id} letterhead={letterhead} portal={portal} />
    </RequireAuth>
  );
}
