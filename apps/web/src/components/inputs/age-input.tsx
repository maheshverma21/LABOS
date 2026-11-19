"use client";

import { useState } from "react";
import { AGE_UNITS, fromDays, toDays, type AgeUnit } from "@lms/shared";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { NumberInput } from "./number-input";

const UNITS = Object.keys(AGE_UNITS) as AgeUnit[];
const LABEL: Record<AgeUnit, string> = { days: "days", months: "mo", years: "yrs" };

/** Edits an age stored as days, shown as a number plus a unit. */
export function AgeInput({
  value,
  onChange,
  invalid,
  placeholder,
  "aria-label": ariaLabel,
}: {
  value: number | null | undefined;
  onChange: (days: number | null) => void;
  invalid?: boolean;
  placeholder?: string;
  "aria-label"?: string;
}) {
  const [unit, setUnit] = useState<AgeUnit>(() => (value == null ? "years" : fromDays(value).unit));
  const shown = value == null ? null : value / AGE_UNITS[unit];

  return (
    <div className="flex min-w-36">
      <NumberInput
        aria-label={ariaLabel}
        aria-invalid={invalid}
        placeholder={placeholder}
        className="rounded-r-none"
        value={shown == null ? null : Math.round(shown * 100) / 100}
        onChange={(n) => onChange(n == null ? null : toDays(n, unit))}
      />
      <Select
        value={unit}
        onValueChange={(u) => {
          const next = u as AgeUnit;
          setUnit(next);
          if (shown != null) onChange(toDays(shown, next));
        }}
      >
        <SelectTrigger className="w-[4.5rem] rounded-l-none border-l-0 px-2" aria-label="Age unit">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {UNITS.map((u) => (
            <SelectItem key={u} value={u}>
              {LABEL[u]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
