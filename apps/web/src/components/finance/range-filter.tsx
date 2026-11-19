"use client";

import { useState } from "react";
import { todayIST } from "@lms/shared";
import { DateRangeInput } from "@/components/filters/date-range-input";

/** Date range state shared by the Finance pages (defaults to today). */
export function useRange() {
  const [from, setFrom] = useState(todayIST());
  const [to, setTo] = useState(todayIST());
  return { from, to, set: (f: string, t: string) => { setFrom(f); setTo(t); } };
}

export function RangeFilter({ range }: { range: ReturnType<typeof useRange> }) {
  return <DateRangeInput from={range.from} to={range.to} onChange={range.set} />;
}
