import { useQuery } from "@tanstack/react-query";
import type { OrderListItem, OrderPage } from "@lms/shared";
import { api } from "./api";

/** Every non-cancelled-or-cancelled order in a date range, fetched page by page (the API caps a page at 100). */
export async function fetchAllOrders(date: string, dateTo: string, status = ""): Promise<OrderListItem[]> {
  const all: OrderListItem[] = [];
  for (let page = 1; page <= 200; page++) {
    const qs = new URLSearchParams({ date, dateTo, page: String(page), pageSize: "100", ...(status ? { status } : {}) });
    const r = await api<OrderPage>(`/orders?${qs}`);
    all.push(...r.orders);
    if (all.length >= r.total || r.orders.length === 0) break;
  }
  return all;
}

export function useAllOrders(date: string, dateTo: string) {
  return useQuery({ queryKey: ["finance", "orders", date, dateTo], queryFn: () => fetchAllOrders(date, dateTo) });
}

const esc = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function downloadCsv(filename: string, header: string[], rows: (string | number)[][]) {
  const csv = [header, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const rupees = (paise: number) => (paise / 100).toFixed(2);

/** Sums for a set of orders; cancelled bills are left out of money totals. */
export function summarise(orders: OrderListItem[]) {
  const active = orders.filter((o) => o.status === "ACTIVE");
  return {
    count: active.length,
    cancelled: orders.length - active.length,
    billedPaise: active.reduce((a, o) => a + o.netPaise, 0),
    paidPaise: active.reduce((a, o) => a + o.paidPaise, 0),
    duePaise: active.filter((o) => !o.account).reduce((a, o) => a + Math.max(o.netPaise - o.paidPaise, 0), 0),
    onAccountPaise: active.filter((o) => o.account).reduce((a, o) => a + o.netPaise, 0),
    /** Paid out to referring doctors, and what's left for the lab after it. */
    doctorSharePaise: active.reduce((a, o) => a + o.commissionPaise, 0),
    labSharePaise: active.reduce((a, o) => a + o.netPaise - o.commissionPaise, 0),
  };
}

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** The period of equal length straight before from..to. */
export function previousRange(from: string, to: string) {
  const a = Date.parse(from), b = Date.parse(to);
  const days = Math.round((b - a) / DAY) + 1;
  return { from: iso(a - days * DAY), to: iso(a - DAY) };
}

export const pctChange = (now: number, before: number) => (before === 0 ? (now === 0 ? 0 : null) : ((now - before) / before) * 100);

const html = (v: string | number) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const tableHtml = (header: string[], rows: (string | number)[][]) =>
  `<table border="1" cellspacing="0" cellpadding="4"><thead><tr>${header.map((h) => `<th>${html(h)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${html(c)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;

/** An Excel-readable .xls file (an HTML table, which Excel opens as a sheet). */
export function downloadXls(filename: string, header: string[], rows: (string | number)[][]) {
  const doc = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body>${tableHtml(header, rows)}</body></html>`;
  const url = URL.createObjectURL(new Blob([doc], { type: "application/vnd.ms-excel" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Opens a print view of the report; choose "Save as PDF" in the print dialog. */
export function printReport(title: string, subtitle: string, header: string[], rows: (string | number)[][]) {
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.write(
    `<html><head><title>${html(title)}</title><style>body{font:12px sans-serif;padding:16px}h1{font-size:18px;margin:0}p{margin:4px 0 12px;color:#555}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:4px 6px;text-align:left}th{background:#eee}</style></head><body><h1>${html(title)}</h1><p>${html(subtitle)}</p>${tableHtml(header, rows)}</body></html>`,
  );
  w.document.close();
  w.focus();
  w.print();
  return true;
}

const ord = (d: number) => (d % 10 === 1 && d !== 11 ? "st" : d % 10 === 2 && d !== 12 ? "nd" : d % 10 === 3 && d !== 13 ? "rd" : "th");

/** "14th Nov, 2026 08:52 am" in India time. Pass a date-only string for a start/end of day. */
export function longDateTime(v: string | Date, edge?: "start" | "end") {
  const t = typeof v === "string" && edge ? new Date(`${v}T${edge === "start" ? "00:00:00" : "23:59:00"}+05:30`) : new Date(v);
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true })
      .formatToParts(t)
      .map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  return `${Number(p.day)}${ord(Number(p.day))} ${p.month}, ${p.year} ${p.hour}:${p.minute} ${p.dayPeriod.toLowerCase()}`;
}

/**
 * Opens the print view laid out like the lab's referral report: centred two-line title,
 * rules instead of cell borders, numbers right-aligned, and a Total row.
 * `numeric` is the index of the first money column; everything from there on is right-aligned.
 */
export function printStatement(title: string, period: string, header: string[], rows: (string | number)[][], totals: (string | number)[], numeric: number) {
  const w = window.open("", "_blank");
  if (!w) return false;
  const cell = (tag: "th" | "td", v: string | number, i: number) => `<${tag}${i >= numeric ? ' class="n"' : ""}>${html(v)}</${tag}>`;
  w.document.write(
    `<html><head><title>${html(title)}</title><style>
@page{size:A4 landscape;margin:12mm}
body{font:12px Roboto,Helvetica,Arial,sans-serif;color:#111;padding:16px}
h1{font-size:18px;font-weight:600;text-align:center;margin:0 0 14px;line-height:1.3}
table{border-collapse:collapse;width:100%}
thead tr{border-top:2px solid #111;border-bottom:2px solid #111}
th{font-weight:500;text-align:left;padding:8px 6px;vertical-align:top}
td{padding:10px 6px;vertical-align:top}
tbody tr{border-bottom:1px solid #999}
.n{text-align:right}
tfoot tr{border-bottom:2px solid #111}
tfoot td{font-weight:500}
</style></head><body><h1>${html(title)}<br>${html(period)}</h1><table><thead><tr>${header.map((h, i) => cell("th", h, i)).join("")}</tr></thead><tbody>${rows
      .map((r) => `<tr>${r.map((c, i) => cell("td", c, i)).join("")}</tr>`)
      .join("")}</tbody><tfoot><tr>${totals.map((c, i) => cell("td", c, i)).join("")}</tr></tfoot></table></body></html>`,
  );
  w.document.close();
  w.focus();
  w.print();
  return true;
}
