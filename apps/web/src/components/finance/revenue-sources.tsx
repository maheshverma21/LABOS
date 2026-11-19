"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatINR } from "@lms/shared";
import type { OrderListItem } from "@lms/shared";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { pctChange } from "@/lib/finance";
import { cn } from "@/lib/utils";

type Source = "b2b" | "referral" | "branch";

const SOURCES: Record<Source, { title: string; column: string; pieTitle: string; key: (o: OrderListItem) => string | null }> = {
  b2b: { title: "B2B Business", column: "Organisation Name", pieTitle: "Top Organisations", key: (o) => o.account?.name ?? null },
  referral: { title: "Referral Business", column: "Referring Doctor", pieTitle: "Top Referrers", key: (o) => o.doctor?.name ?? null },
  branch: { title: "Branch Business", column: "Branch", pieTitle: "Top Branches", key: (o) => o.branch?.name ?? null },
};

const COLORS = ["#2979ff", "#ffc107", "#6200ea", "#00bcd4", "#d2691e", "#7e57c2", "#9e9e9e"];

function tally(orders: OrderListItem[], key: (o: OrderListItem) => string | null) {
  const m = new Map<string, { revenue: number; bills: number; doctor: number }>();
  for (const o of orders) {
    if (o.status !== "ACTIVE") continue;
    const k = key(o);
    if (!k) continue;
    const row = m.get(k) ?? { revenue: 0, bills: 0, doctor: 0 };
    row.revenue += o.netPaise;
    row.bills += 1;
    row.doctor += o.commissionPaise;
    m.set(k, row);
  }
  return [...m.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.revenue - a.revenue);
}

const total = (rows: { revenue: number }[]) => rows.reduce((a, r) => a + r.revenue, 0);

export function RevenueSources({ orders, prevOrders }: { orders: OrderListItem[]; prevOrders?: OrderListItem[] }) {
  const [source, setSource] = useState<Source>("b2b");
  const [q, setQ] = useState("");

  const cards = useMemo(
    () =>
      (Object.keys(SOURCES) as Source[]).map((k) => {
        const now = total(tally(orders, SOURCES[k].key));
        const before = prevOrders ? total(tally(prevOrders, SOURCES[k].key)) : null;
        return { k, now, delta: before == null ? null : pctChange(now, before) };
      }),
    [orders, prevOrders],
  );
  const rows = useMemo(() => tally(orders, SOURCES[source].key), [orders, source]);
  const shown = rows.filter((r) => r.name.toLowerCase().includes(q.trim().toLowerCase()));

  // Pie: the top 6 and everything else lumped together.
  const sum = total(rows);
  const slices = [...rows.slice(0, 6), ...(rows.length > 6 ? [{ name: "OTHERS", revenue: total(rows.slice(6)), bills: 0, doctor: 0 }] : [])];
  let acc = 0;
  const gradient = slices
    .map((s, i) => {
      const from = (acc / (sum || 1)) * 100;
      acc += s.revenue;
      return `${COLORS[i]} ${from}% ${(acc / (sum || 1)) * 100}%`;
    })
    .join(", ");
  const top = slices[0];

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold tracking-tight">Revenue Sources</h2>
        <Link href="/finance/mis" className="text-sm text-primary hover:underline">View performance</Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 lg:max-w-4xl">
        {cards.map((c) => {
          const active = c.k === source;
          const up = (c.delta ?? 0) >= 0;
          return (
            <button key={c.k} type="button" onClick={() => setSource(c.k)} className="text-left">
              <Card className={cn("gap-1 py-4 transition", active ? "border-blue-500 bg-blue-500 text-white shadow-md" : "hover:border-blue-300")}>
                <CardContent className="space-y-1 px-4">
                  <div className={cn("text-sm font-medium", active ? "text-white" : "text-foreground")}>{SOURCES[c.k].title}</div>
                  <div className={cn("text-2xl tabular-nums", active ? "text-white" : "text-blue-600")}>{formatINR(c.now)}</div>
                  {c.delta != null && (
                    <div className={cn("text-xs", active ? "text-white" : up ? "text-green-600" : "text-red-600")}>
                      {up ? "▲" : "▼"} {Math.abs(c.delta).toFixed(2)}%
                    </div>
                  )}
                </CardContent>
              </Card>
            </button>
          );
        })}
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[1fr_26rem]">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">Rows: {shown.length}</span>
            <Input className="w-56" placeholder={`Filter ${SOURCES[source].column.toLowerCase()}`} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Card className="py-0">
            <CardContent className="max-h-96 overflow-auto px-0">
              <Table>
                <TableHeader className="sticky top-0 bg-muted">
                  <TableRow>
                    <TableHead>{SOURCES[source].column}</TableHead>
                    <TableHead className="text-right">Total Revenue</TableHead>
                    <TableHead className="text-right">Total Bills</TableHead>
                    {source === "referral" && <TableHead className="text-right">Doctor Share</TableHead>}
                    {source === "referral" && <TableHead className="text-right">Lab Share</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.length === 0 && (
                    <TableRow><TableCell colSpan={source === "referral" ? 5 : 3} className="py-6 text-center text-muted-foreground">No data in this period.</TableCell></TableRow>
                  )}
                  {shown.map((r) => (
                    <TableRow key={r.name}>
                      <TableCell className="font-semibold">{r.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatINR(r.revenue)}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.bills}</TableCell>
                      {source === "referral" && <TableCell className="text-right tabular-nums">{formatINR(r.doctor)}</TableCell>}
                      {source === "referral" && <TableCell className="text-right tabular-nums">{formatINR(r.revenue - r.doctor)}</TableCell>}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="space-y-5">
            <h3 className="text-center text-lg font-semibold">{SOURCES[source].pieTitle}</h3>
            {sum === 0 ? (
              <p className="py-16 text-center text-sm text-muted-foreground">No data in this period.</p>
            ) : (
              <>
                <div className="mx-auto size-56 rounded-full" style={{ background: `conic-gradient(${gradient})` }} role="img" aria-label={`${SOURCES[source].pieTitle}: ${top?.name} ${((top.revenue / sum) * 100).toFixed(2)}%`} />
                <p className="text-center text-sm text-muted-foreground">{top?.name}: {((top.revenue / sum) * 100).toFixed(2)} %</p>
                <ul className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  {slices.map((s, i) => (
                    <li key={s.name} className="flex items-center gap-2">
                      <i className="size-3.5 shrink-0 rounded-full" style={{ background: COLORS[i] }} />
                      <span className="truncate" title={`${s.name} · ${((s.revenue / sum) * 100).toFixed(2)}%`}>{s.name}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
