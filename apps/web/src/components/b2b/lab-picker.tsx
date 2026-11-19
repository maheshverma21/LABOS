"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAccounts } from "@/lib/accounts";

const ALL = "__all";

/** A lab chooser. With `allLabel`, "" means every lab. */
export function LabPicker({
  value,
  onChange,
  allLabel,
  placeholder = "Pick a lab",
  className,
  id,
}: {
  value: string;
  onChange: (id: string) => void;
  allLabel?: string;
  placeholder?: string;
  className?: string;
  id?: string;
}) {
  const labs = useAccounts("", true);
  return (
    <Select value={value || (allLabel ? ALL : "")} onValueChange={(v) => onChange(v === ALL ? "" : v)}>
      <SelectTrigger id={id} className={className ?? "w-full sm:w-64"} aria-label="Lab">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allLabel && <SelectItem value={ALL}>{allLabel}</SelectItem>}
        {labs.data?.map((l) => (
          <SelectItem key={l.id} value={l.id}>
            {l.name} ({l.code})
            {!l.isActive && " · off"}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Rupees with a minus sign and red when negative. */
export function Money({ paise, className, plain }: { paise: number; className?: string; plain?: boolean }) {
  // `plain` drops the rupee sign, for tables where every amount is in rupees.
  const text = plain ? `${paise < 0 ? "-" : ""}${Math.abs(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : formatRupees(paise);
  return <span className={`${paise < 0 ? "text-red-600 dark:text-red-400" : ""} ${className ?? ""} tabular-nums`}>{text}</span>;
}

export const formatRupees = (paise: number) => `${paise < 0 ? "-" : ""}₹${Math.abs(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
