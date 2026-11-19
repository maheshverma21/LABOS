"use client";

import { useState } from "react";
import { todayIST } from "@lms/shared";

const back = (iso: string, days: number) => new Date(new Date(`${iso}T00:00:00Z`).getTime() - days * 86_400_000).toISOString().slice(0, 10);

/** A date range that starts `days` days back and ends today (IST). */
export function useDateRange(days = 29) {
  const [range, set] = useState(() => ({ from: back(todayIST(), days), to: todayIST() }));
  return { ...range, set: (from: string, to: string) => set({ from, to }) };
}
