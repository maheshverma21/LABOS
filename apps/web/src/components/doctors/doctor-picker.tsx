"use client";

import { useState } from "react";
import { CheckIcon, ChevronsUpDownIcon, PlusIcon, StethoscopeIcon } from "lucide-react";
import type { DoctorItem } from "@lms/shared";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DoctorDialog } from "@/components/doctors/doctor-dialog";
import { useAuth } from "@/providers/auth-provider";
import { useDoctors } from "@/lib/patients";
import { cn } from "@/lib/utils";

/**
 * Picks a referring doctor from the Referring doctors list, or adds a new one
 * (with commission) without leaving the page.
 */
export function DoctorPicker({
  value,
  onChange,
  noneLabel = "Self / no referral",
  fallbackLabel,
  id,
}: {
  value: DoctorItem | null;
  onChange: (d: DoctorItem | null) => void;
  noneLabel?: string;
  /** Shown when nothing is picked but a name is already on record. */
  fallbackLabel?: string;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [dialog, setDialog] = useState<{ open: boolean; name: string; n: number }>({ open: false, name: "", n: 0 });
  const { can } = useAuth();
  const { data } = useDoctors(q.trim());
  const label = value?.name ?? fallbackLabel ?? noneLabel;

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label="Referring doctor"
            className="w-full justify-between font-normal"
          >
            <span className={cn("truncate", !value && "text-muted-foreground")}>{label}</span>
            <ChevronsUpDownIcon className="opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) min-w-72 p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput placeholder="Search doctors" value={q} onValueChange={setQ} />
            <CommandList>
              <CommandEmpty>No doctor found.</CommandEmpty>
              <CommandGroup>
                <CommandItem
                  value="__self"
                  onSelect={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                >
                  <span className="flex-1">{noneLabel}</span>
                  {!value && !fallbackLabel && <CheckIcon />}
                </CommandItem>
                {data?.map((d) => (
                  <CommandItem
                    key={d.id}
                    value={d.id}
                    onSelect={() => {
                      onChange(d);
                      setOpen(false);
                    }}
                  >
                    <StethoscopeIcon className="text-muted-foreground" />
                    <span className="flex-1 truncate">
                      {d.name}
                      {d.clinicName && <span className="text-muted-foreground"> · {d.clinicName}</span>}
                    </span>
                    {d.commissionPercent > 0 && (
                      <span className="text-xs text-muted-foreground tabular-nums">{d.commissionPercent}%</span>
                    )}
                    {value?.id === d.id && <CheckIcon />}
                  </CommandItem>
                ))}
              </CommandGroup>
              {can("patients:write") && (
                <CommandGroup>
                  <CommandItem
                    value="__add"
                    onSelect={() => {
                      setDialog((s) => ({ open: true, name: q.trim(), n: s.n + 1 }));
                      setOpen(false);
                    }}
                  >
                    <PlusIcon />
                    {q.trim() ? `Add doctor “${q.trim()}”` : "Add new doctor"}
                  </CommandItem>
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <DoctorDialog
        key={dialog.n}
        doctor={null}
        initialName={dialog.name}
        open={dialog.open}
        onOpenChange={(o) => setDialog((s) => ({ ...s, open: o }))}
        onSaved={(d) => onChange(d)}
      />
    </>
  );
}
