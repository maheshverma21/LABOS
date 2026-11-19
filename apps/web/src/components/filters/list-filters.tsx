"use client";

import { useState } from "react";
import { CheckIcon, ChevronsUpDownIcon, FilterIcon, XIcon } from "lucide-react";
import { FILTER_NONE, LIST_FILTER_KEYS, LIST_FILTER_LABEL, activeFilterCount, type ListFilterKey, type ListFilters } from "@lms/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/providers/auth-provider";
import { useAccounts } from "@/lib/accounts";
import { useTests } from "@/lib/catalog";
import { useDoctors } from "@/lib/patients";
import { cn } from "@/lib/utils";

/** Applied filters plus the names to show on their chips. */
export interface FilterState {
  values: ListFilters;
  labels: Partial<Record<ListFilterKey, string>>;
}

const EMPTY: FilterState = { values: {}, labels: {} };
const storageKey = (page: string) => `filters:${page}`;

function load(page: string): FilterState {
  try {
    const raw = sessionStorage.getItem(storageKey(page));
    return raw ? (JSON.parse(raw) as FilterState) : EMPTY;
  } catch {
    return EMPTY;
  }
}

/** A page's filters, kept for the browser tab so they survive moving between pages. */
export function useListFilters(page: string) {
  const [state, setState] = useState<FilterState>(() => (typeof window === "undefined" ? EMPTY : load(page)));
  const update = (next: FilterState) => {
    setState(next);
    try {
      sessionStorage.setItem(storageKey(page), JSON.stringify(next));
    } catch {
      // Private mode: filters last until reload.
    }
  };
  return [state, update] as const;
}

type Option = { value: string; label: string; hint?: string };

/** A searchable picker, for lists that can be long (doctors, tests). */
function SearchPick({
  id,
  options,
  value,
  onChange,
  placeholder,
  search,
  onSearch,
}: {
  id: string;
  options: Option[];
  value: string | undefined;
  onChange: (o: Option | null) => void;
  placeholder: string;
  search?: string;
  onSearch?: (q: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button id={id} variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal">
          <span className={cn("truncate", !current && "text-muted-foreground")}>{current?.label ?? placeholder}</span>
          <ChevronsUpDownIcon className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command shouldFilter={!onSearch}>
          <CommandInput placeholder="Search…" value={search} onValueChange={onSearch} />
          <CommandList>
            <CommandEmpty>Nothing found.</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={`${o.label} ${o.hint ?? ""} ${o.value}`}
                  onSelect={() => {
                    onChange(o.value === value ? null : o);
                    setOpen(false);
                  }}
                >
                  <CheckIcon className={cn(o.value === value ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{o.label}</span>
                  {o.hint && <span className="ml-auto text-xs text-muted-foreground">{o.hint}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The "Filters" button and the panel it opens on the right: referring doctor,
 * B2B account, branch / collection centre and test. Pass `keys` to offer fewer.
 */
export function ListFilterButton({
  state,
  onChange,
  keys = LIST_FILTER_KEYS,
}: {
  state: FilterState;
  onChange: (s: FilterState) => void;
  keys?: readonly ListFilterKey[];
}) {
  const { user, can } = useAuth();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<FilterState>(state);
  const [doctorQ, setDoctorQ] = useState("");
  const doctors = useDoctors(doctorQ);
  const tests = useTests();
  const accountsOn = keys.includes("accountId") && can("accounts:read");
  const accounts = useAccounts("", false, accountsOn && open);
  const branches = user?.branches ?? [];
  const count = activeFilterCount(state.values);

  const set = (k: ListFilterKey, o: Option | null) =>
    setDraft((d) => ({ values: { ...d.values, [k]: o?.value }, labels: { ...d.labels, [k]: o?.label } }));

  const options: Record<ListFilterKey, Option[]> = {
    doctorId: [{ value: FILTER_NONE, label: "Self (no referring doctor)" }, ...(doctors.data ?? []).map((d) => ({ value: d.id, label: d.name, hint: d.city ?? undefined }))],
    accountId: [{ value: FILTER_NONE, label: "Walk-in (no account)" }, ...(accounts.data ?? []).map((a) => ({ value: a.id, label: a.name, hint: a.code }))],
    branchId: branches.map((b) => ({ value: b.id, label: b.name })),
    testId: (tests.data ?? []).map((t) => ({ value: t.id, label: t.name, hint: t.code })),
  };
  // Keep the chosen doctor in the list while searching for another.
  const chosenDoctor = draft.values.doctorId;
  if (chosenDoctor && !options.doctorId.some((o) => o.value === chosenDoctor)) {
    options.doctorId.push({ value: chosenDoctor, label: draft.labels.doctorId ?? "Selected doctor" });
  }
  const shown = keys.filter((k) => (k === "accountId" ? accountsOn : k === "branchId" ? branches.length > 1 : true));

  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setDraft(state);
          setOpen(true);
        }}
      >
        <FilterIcon /> Filters
        {count > 0 && <Badge className="ml-0.5 h-5 min-w-5 rounded-full px-1.5 tabular-nums">{count}</Badge>}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full sm:max-w-sm">
          <SheetHeader>
            <SheetTitle>Filters</SheetTitle>
            <SheetDescription>Show only orders that match all of these.</SheetDescription>
          </SheetHeader>
          <div className="grid gap-5 overflow-y-auto px-4">
            {shown.map((k) => (
              <div key={k} className="grid gap-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor={`f-${k}`}>{LIST_FILTER_LABEL[k]}</Label>
                  {draft.values[k] && (
                    <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => set(k, null)}>
                      Clear
                    </button>
                  )}
                </div>
                <SearchPick
                  id={`f-${k}`}
                  options={options[k]}
                  value={draft.values[k]}
                  onChange={(o) => set(k, o)}
                  placeholder="Any"
                  {...(k === "doctorId" ? { search: doctorQ, onSearch: setDoctorQ } : {})}
                />
              </div>
            ))}
          </div>
          <SheetFooter className="flex-row gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setDraft(EMPTY)}>
              Clear all
            </Button>
            <Button
              className="flex-1"
              onClick={() => {
                onChange(draft);
                setOpen(false);
              }}
            >
              Apply
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}

/** The applied filters as removable chips, shown under the toolbar. */
export function ActiveFilterChips({ state, onChange }: { state: FilterState; onChange: (s: FilterState) => void }) {
  const active = LIST_FILTER_KEYS.filter((k) => state.values[k]);
  if (active.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {active.map((k) => (
        <Badge key={k} variant="secondary" className="h-7 gap-1 pr-1 pl-2.5 text-xs font-normal">
          <span className="text-muted-foreground">{LIST_FILTER_LABEL[k]}:</span> {state.labels[k] ?? "Selected"}
          <button
            type="button"
            aria-label={`Remove ${LIST_FILTER_LABEL[k]} filter`}
            className="rounded-full p-0.5 hover:bg-foreground/10"
            onClick={() => onChange({ values: { ...state.values, [k]: undefined }, labels: { ...state.labels, [k]: undefined } })}
          >
            <XIcon className="size-3.5" />
          </button>
        </Badge>
      ))}
      <Button variant="ghost" size="sm" onClick={() => onChange(EMPTY)}>
        Clear all
      </Button>
    </div>
  );
}
