"use client";

import { useState } from "react";
import { useController, useFormContext } from "react-hook-form";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, XIcon } from "lucide-react";
import { formatINR } from "@lms/shared";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTests } from "@/lib/catalog";
import type { TestFormValues } from "./form-types";

export function PanelTestsEditor({ selfId }: { selfId?: string }) {
  const { control, formState } = useFormContext<TestFormValues>();
  const { field } = useController({ control, name: "panelTestIds" });
  const [open, setOpen] = useState(false);
  const tests = useTests();

  const ids = field.value ?? [];
  const candidates = (tests.data ?? []).filter((t) => !t.isPanel && t.id !== selfId);
  const byId = new Map(candidates.map((t) => [t.id, t]));
  const selected = ids.map((id) => byId.get(id)).filter((t) => !!t);
  const available = candidates.filter((t) => !ids.includes(t.id));
  const total = selected.reduce((sum, t) => sum + t.pricePaise, 0);

  const set = (next: string[]) => field.onChange(next);
  const move = (from: number, to: number) => {
    const next = [...ids];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    set(next);
  };

  const error = formState.errors.panelTestIds;

  return (
    <div className="space-y-3">
      <ol className="divide-y rounded-lg border">
        {selected.map((t, i) => (
          <li key={t.id} className="flex items-center gap-2 px-2 py-1.5 text-sm">
            <span className="w-6 text-right text-muted-foreground tabular-nums">{i + 1}.</span>
            <span className="w-20 font-mono text-xs text-muted-foreground">{t.code}</span>
            <span className="flex-1">{t.name}</span>
            <span className="tabular-nums text-muted-foreground">{t.pricePaise ? formatINR(t.pricePaise) : "—"}</span>
            <Button type="button" variant="ghost" size="icon" className="size-7" aria-label="Move up" disabled={i === 0} onClick={() => move(i, i - 1)}>
              <ArrowUpIcon />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label="Move down"
              disabled={i === selected.length - 1}
              onClick={() => move(i, i + 1)}
            >
              <ArrowDownIcon />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={`Remove ${t.name}`}
              onClick={() => set(ids.filter((x) => x !== t.id))}
            >
              <XIcon />
            </Button>
          </li>
        ))}
        {selected.length === 0 && <li className="px-3 py-3 text-sm text-muted-foreground">No tests added yet.</li>}
      </ol>

      {error && <p className="text-sm text-destructive">{error.message ?? error.root?.message}</p>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline">
              <PlusIcon /> Add test
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-0" align="start">
            <Command>
              <CommandInput placeholder="Search tests" />
              <CommandList>
                <CommandEmpty>No tests found.</CommandEmpty>
                <CommandGroup>
                  {available.map((t) => (
                    <CommandItem
                      key={t.id}
                      value={`${t.code} ${t.name}`}
                      onSelect={() => {
                        set([...ids, t.id]);
                        setOpen(false);
                      }}
                    >
                      <span className="w-16 font-mono text-xs text-muted-foreground">{t.code}</span>
                      <span className="flex-1 truncate">{t.name}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        {selected.length > 0 && (
          <p className="text-sm text-muted-foreground">
            Tests bought separately: <span className="font-medium text-foreground">{formatINR(total)}</span>
          </p>
        )}
      </div>
    </div>
  );
}
