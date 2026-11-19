import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** `delta` is the % change vs the previous period; `invert` means going up is bad (dues, discounts). */
export function Stat({ label, value, hint, strong, delta, invert, highlight }: { label: string; value: string; hint?: string; strong?: boolean; delta?: number | null; invert?: boolean; highlight?: boolean }) {
  const good = delta == null ? true : invert ? delta <= 0 : delta >= 0;
  return (
    <Card className={cn("gap-1 py-4", highlight && "border-blue-500 bg-blue-500 text-white")}>
      <CardContent className="space-y-1 px-4">
        <div className={cn("text-xs text-muted-foreground", highlight && "text-white/80")}>{label}</div>
        <div className={cn("text-xl tabular-nums", strong ? "font-semibold" : "font-medium")}>{value}</div>
        {delta != null && (
          <div className={cn("flex items-center gap-1 text-xs", highlight ? "text-white" : good ? "text-green-600" : "text-red-600")}>
            {delta >= 0 ? <ChevronUpIcon className="size-3.5" /> : <ChevronDownIcon className="size-3.5" />}
            {Math.abs(delta).toFixed(2)}% <span className="text-muted-foreground">vs previous period</span>
          </div>
        )}
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}
