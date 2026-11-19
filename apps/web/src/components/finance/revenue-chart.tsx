import { formatINR } from "@lms/shared";
import type { OrderListItem } from "@lms/shared";
import { summarise } from "@/lib/finance";

const DAY = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function ordinal(n: number) {
  const v = n % 100;
  return n + (["th", "st", "nd", "rd"][(v - 20) % 10] ?? ["th", "st", "nd", "rd"][v] ?? "th");
}
/** 2026-11-01 → "1st Nov, 2026" */
const label = (d: string) => `${ordinal(Number(d.slice(8, 10)))} ${MONTHS[Number(d.slice(5, 7)) - 1]}, ${d.slice(0, 4)}`;

/** A round step (1, 2, 5 × 10ⁿ) giving roughly 7 gridlines. */
function niceStep(max: number) {
  const raw = max / 7;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
}

/** Stacked bars per day: paid (blue) at the bottom, due (amber) on top. Amounts on the axis are in rupees. */
export function RevenueChart({ orders, from, to }: { orders: OrderListItem[]; from: string; to: string }) {
  const byDay = new Map<string, OrderListItem[]>();
  for (const o of orders) {
    const d = o.createdAt.slice(0, 10);
    byDay.set(d, [...(byDay.get(d) ?? []), o]);
  }
  // Every day in the range gets a slot, even with no bills.
  const days: { d: string; paid: number; due: number }[] = [];
  for (let t = Date.parse(from); t <= Date.parse(to) && days.length < 92; t += DAY) {
    const d = new Date(t).toISOString().slice(0, 10);
    const s = summarise(byDay.get(d) ?? []);
    const paid = Math.min(s.paidPaise, s.billedPaise);
    days.push({ d, paid: paid / 100, due: (s.billedPaise - paid) / 100 });
  }
  const maxVal = Math.max(1, ...days.map((x) => x.paid + x.due));
  const step = niceStep(maxVal);
  const top = Math.ceil(maxVal / step) * step;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const dense = days.length > 10;

  return (
    <div>
      <div className="mb-4 flex items-center justify-center gap-5 text-sm">
        <span className="flex items-center gap-2"><i className="size-4 rounded-full bg-[#ffc107]" /> Due Business</span>
        <span className="flex items-center gap-2"><i className="size-4 rounded-full bg-[#2979ff]" /> Paid Business</span>
      </div>

      <div className="flex">
        {/* y axis */}
        <div className="relative mr-2 h-72 w-12 shrink-0 text-right text-xs text-muted-foreground">
          {ticks.map((v) => (
            <span key={v} className="absolute right-0 -translate-y-1/2 tabular-nums" style={{ bottom: `${(v / top) * 100}%` }}>{v}</span>
          ))}
        </div>

        <div className="min-w-0 flex-1">
          {/* plot */}
          <div className="relative h-72 border-b border-l border-border">
            {ticks.slice(1).map((v) => (
              <div key={v} className="absolute inset-x-0 border-t border-dashed border-border" style={{ bottom: `${(v / top) * 100}%` }} />
            ))}
            <div className="absolute inset-0 flex">
              {days.map((x) => (
                <div key={x.d} className="relative flex h-full flex-1 justify-center border-r border-dashed border-border/60 last:border-r-0" title={`${label(x.d)}\nPaid: ${formatINR(x.paid * 100)}\nDue: ${formatINR(x.due * 100)}`}>
                  <div className="flex h-full w-[65%] max-w-32 flex-col justify-end">
                    <div className="bg-[#ffc107]" style={{ height: `${(x.due / top) * 100}%` }} />
                    <div className="bg-[#2979ff]" style={{ height: `${(x.paid / top) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
          {/* x axis */}
          <div className="flex pt-2 text-xs text-muted-foreground">
            {days.map((x) => (
              <span key={x.d} className={dense ? "flex-1 whitespace-nowrap text-center" : "flex-1 text-center"}>
                {dense ? x.d.slice(8) + " " + MONTHS[Number(x.d.slice(5, 7)) - 1] : label(x.d)}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
