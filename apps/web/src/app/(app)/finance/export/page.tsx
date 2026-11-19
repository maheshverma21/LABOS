"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { OrderDetail, OrderListItem } from "@lms/shared";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RangeFilter, useRange } from "@/components/finance/range-filter";
import { api } from "@/lib/api";
import { APP_NAME } from "@/lib/brand";
import { downloadXls, fetchAllOrders, longDateTime, printReport, printStatement, rupees } from "@/lib/finance";
import { useAccounts } from "@/lib/accounts";
import { useOutsourceLabs } from "@/lib/outsourcing";
import { useDoctors } from "@/lib/patients";
import { cn } from "@/lib/utils";

type Tab = "referral" | "outsource" | "organisation" | "other";
type BillFilter = "all" | "paid" | "due";

const TABS: { id: Tab; label: string; title: string; description: string; selectLabel?: string; allLabel?: string }[] = [
  { id: "referral", label: "Referral", title: "Referral Report", description: "Generate and download reports related to Billing Referral", selectLabel: "Referral", allLabel: "All Referral (Only For Excel)" },
  { id: "outsource", label: "Outsource", title: "Outsource Report", description: "Generate and download reports of tests sent to outsourced labs", selectLabel: "Outsource Lab", allLabel: "All Outsource Labs (Only For Excel)" },
  { id: "organisation", label: "Organisation", title: "Organisation Report", description: "Generate and download reports related to B2B organisation billing", selectLabel: "Organisation", allLabel: "All Organisation (Only For Excel)" },
  { id: "other", label: "Any Other", title: "Bills Report", description: "Generate and download a report of every bill in the selected period" },
];

const PDF_HEADER = ["Bill ID", "Date & Time", "Patient Name", "Sample collected / Organization", "Sponsor", "Gross", "Discount", "Net", "Doctor Share", "Lab Share", "Paid", "Due"];

const matchesBill = (o: OrderListItem, f: BillFilter) =>
  f === "all" ? true : f === "paid" ? o.paymentStatus === "PAID" : o.status === "ACTIVE" && !o.account && o.duePaise > 0;

/** Fetches full bills a few at a time (the list doesn't say which lab a test goes to). */
async function fetchDetails(orders: OrderListItem[]) {
  const out: OrderDetail[] = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (i < orders.length) {
        const o = orders[i++];
        out.push(await api<{ order: OrderDetail }>(`/orders/${o.id}`).then((r) => r.order));
      }
    }),
  );
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export default function FinanceExportPage() {
  const [tab, setTab] = useState<Tab>("referral");
  const [selected, setSelected] = useState("");
  const [all, setAll] = useState(false);
  const [bills, setBills] = useState<BillFilter>("all");
  const [busy, setBusy] = useState<"xls" | "pdf" | null>(null);
  const range = useRange();

  const doctors = useDoctors("", true);
  const accounts = useAccounts("", true);
  const labs = useOutsourceLabs();
  const cfg = TABS.find((t) => t.id === tab)!;

  const options: { id: string; name: string }[] =
    tab === "referral" ? (doctors.data ?? []) : tab === "organisation" ? (accounts.data ?? []) : tab === "outsource" ? (labs.data ?? []) : [];
  const needsSelection = tab !== "other" && !all;

  function switchTab(t: Tab) {
    setTab(t);
    setSelected("");
    setAll(false);
  }

  /** Builds the header and rows for the chosen tab, or null when there is nothing to export. */
  async function build(forPdf: boolean): Promise<{ header: string[]; rows: (string | number)[][]; who: string; orders?: OrderListItem[] } | null> {
    let orders = await fetchAllOrders(range.from, range.to);
    // PDF leaves out cancelled / refunded bills; Excel keeps them.
    if (forPdf) orders = orders.filter((o) => o.status === "ACTIVE");
    orders = orders.filter((o) => matchesBill(o, bills));
    const who = all || tab === "other" ? cfg.label : options.find((o) => o.id === selected)?.name ?? "";

    if (tab === "outsource") {
      const wanted = new Map<string, string>(); // testId -> lab name
      for (const l of labs.data ?? []) if (all || l.id === selected) for (const t of l.tests) wanted.set(t.id, l.name);
      const details = await fetchDetails(orders);
      const rows = details.flatMap((o) => {
        const items = o.items.filter((i) => wanted.has(i.testId));
        if (!items.length) return [];
        return [[o.billNo || o.orderNo, o.createdAt.slice(0, 10), o.patient.name, o.patient.uhid, [...new Set(items.map((i) => wanted.get(i.testId)))].join(", "), items.map((i) => i.name).join("; "), rupees(items.reduce((a, i) => a + i.pricePaise, 0))]];
      });
      return { header: ["Bill no", "Date", "Patient", "UHID", "Outsource lab", "Tests", "Amount (INR)"], rows, who };
    }

    if (tab === "referral") orders = orders.filter((o) => o.doctor && (all || o.doctor.id === selected));
    if (tab === "organisation") orders = orders.filter((o) => o.account && (all || o.account.id === selected));
    if (forPdf) {
      // Statement layout for the PDF; cancelled bills were already dropped above.
      const rows = orders.map((o) => [
        o.billNo || o.orderNo, longDateTime(o.createdAt), o.patient.name,
        o.account?.name ?? "DIRECT", "",
        rupees(o.grossPaise), rupees(o.discountPaise), rupees(o.netPaise),
        rupees(o.commissionPaise), rupees(o.netPaise - o.commissionPaise), rupees(o.paidPaise), rupees(o.duePaise),
      ]);
      return { header: PDF_HEADER, rows, who, orders };
    }
    // Excel layout: one row per bill with its tests and payment type, plus the doctor / lab split.
    const details = (await fetchDetails(orders)).reverse(); // oldest first, so bill numbers run upwards
    const ddmmyyyy = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata" }).replace(/\//g, "-");
    const rows: (string | number)[][] = details.map((o) => [
      o.billNo || o.orderNo, ddmmyyyy(o.createdAt), o.patient.name,
      o.doctor?.name ?? "SELF",
      o.items.map((i) => `${i.name},`).join(""),
      "", "",
      [...new Set(o.payments.filter((p) => p.kind === "PAYMENT").map((p) => p.mode))].join(", "),
      o.grossPaise / 100, o.discountPaise / 100, o.netPaise / 100, o.paidPaise / 100, o.duePaise / 100,
      o.status === "CANCELLED" ? "Cancelled" : "-",
      o.account?.name ?? "None (Default)",
      o.doctor ? (o.commissionPercent ?? 0) : "", o.commissionPaise / 100, (o.netPaise - o.commissionPaise) / 100,
    ]);
    return { header: ["Bill ID", "Date", "Patient Name", "Referral", "Test Name", "Sponsor", "Services", "Payment Type", "Gross", "Discount", "Net", "Paid", "Due", "Remarks", "Source", "Doctor Commission (%)", "Doctor Share", "Lab Share"], rows, who };
  }

  async function run(kind: "xls" | "pdf") {
    if (needsSelection && !selected) return toast.error(`Select ${cfg.selectLabel?.toLowerCase()} first`);
    setBusy(kind);
    try {
      const r = await build(kind === "pdf");
      if (!r || r.rows.length === 0) return toast.info("No bills found for these filters.");
      const sub = `${r.who} · ${range.from} to ${range.to} · ${bills === "all" ? "All bills" : bills === "paid" ? "Paid bills" : "Due bills"}`;
      if (kind === "xls") downloadXls(`${cfg.id}_report_${range.from}_to_${range.to}.xls`, r.header, r.rows);
      else if (r.orders) {
        const sum = (f: (o: OrderListItem) => number) => rupees(r.orders!.reduce((a, o) => a + f(o), 0));
        const totals = ["", "", "", "", "Total :", sum((o) => o.grossPaise), sum((o) => o.discountPaise), sum((o) => o.netPaise), sum((o) => o.commissionPaise), sum((o) => o.netPaise - o.commissionPaise), sum((o) => o.paidPaise), sum((o) => o.duePaise)];
        const title = tab === "other" ? "Bills Report" : `${cfg.title.replace(" Report", "")} Report for ${r.who}`;
        const period = `from ${longDateTime(range.from, "start")} - ${longDateTime(range.to, "end")}`;
        if (!printStatement(title, period, r.header, r.rows, totals, 5)) toast.error("Allow pop-ups to export the PDF");
      } else if (!printReport(`${cfg.title} · ${APP_NAME}`, sub, r.header, r.rows)) toast.error("Allow pop-ups to export the PDF");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <title>{`Export · ${APP_NAME}`}</title>

      <div className="flex gap-2 border-b">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => switchTab(t.id)}
            className={cn("-mb-px border-b-2 px-4 py-2 text-sm", tab === t.id ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="rounded-lg border bg-card p-6">
        <h1 className="text-2xl font-semibold tracking-tight">{cfg.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{cfg.description}</p>

        <div className="mt-6 grid max-w-4xl items-center gap-x-4 gap-y-4 md:grid-cols-[10rem_1fr]">
          {cfg.selectLabel && (
            <>
              <label className="text-sm md:text-right">{cfg.selectLabel}:</label>
              <Select value={selected} onValueChange={setSelected} disabled={all}>
                <SelectTrigger aria-label={cfg.selectLabel}><SelectValue placeholder={`Select ${cfg.selectLabel}`} /></SelectTrigger>
                <SelectContent>
                  {options.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                </SelectContent>
              </Select>

              <span />
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={all} onCheckedChange={(v) => setAll(v === true)} /> {cfg.allLabel}
              </label>
            </>
          )}

          <label className="text-sm md:text-right">Select Date :</label>
          <RangeFilter range={range} />

          <span />
          <div className="flex flex-wrap items-center gap-5 text-sm">
            {([["all", "All Bills"], ["paid", "Only paid bills"], ["due", "Only due bills"]] as const).map(([v, l]) => (
              <label key={v} className="flex items-center gap-2">
                <input type="radio" name="bills" checked={bills === v} onChange={() => setBills(v)} /> {l}
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">*Note : PDF does not include bills that are either refunded, cancelled or written off. To get info about those bills too, Export in excel.</p>
        <div className="flex gap-2">
          <Button onClick={() => run("xls")} disabled={busy !== null}>{busy === "xls" ? "Preparing…" : "Export Excel"}</Button>
          <Button onClick={() => run("pdf")} disabled={busy !== null || all}>{busy === "pdf" ? "Preparing…" : "Export PDF"}</Button>
        </div>
      </div>
    </>
  );
}
