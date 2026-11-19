"use client";

import { todayIST } from "@lms/shared";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * A from–to pair of date inputs. Keeps the range valid: moving "From" past
 * "To" (or "To" before "From") pulls the other end along. An empty field falls
 * back to today unless `allowEmpty` is set.
 */
export function DateRangeInput({
  from,
  to,
  onChange,
  allowEmpty = false,
  allowFuture = false,
  disabled,
  className,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  allowEmpty?: boolean;
  /** Allow picking days in the future. */
  allowFuture?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const today = todayIST();
  const fix = (v: string) => (v || (allowEmpty ? "" : today));
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Input
        type="date"
        aria-label="From date"
        title="From"
        className="w-40"
        value={from}
        max={allowFuture ? undefined : to || today}
        disabled={disabled}
        onChange={(e) => {
          const f = fix(e.target.value);
          onChange(f, f && to && to < f ? f : f ? to || f : "");
        }}
      />
      <span className="text-sm text-muted-foreground">to</span>
      <Input
        type="date"
        aria-label="To date"
        title="To"
        className="w-40"
        value={to}
        min={from || undefined}
        max={allowFuture ? undefined : today}
        disabled={disabled}
        onChange={(e) => {
          const t = fix(e.target.value);
          onChange(from && t && from > t ? t : from || t, t);
        }}
      />
    </div>
  );
}
