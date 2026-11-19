"use client";

import { useState } from "react";
import { PencilIcon, SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { REGISTRATION_FIELDS, type DisplaySettings } from "@/lib/registration-settings";

type Props = { d: DisplaySettings; set: (next: DisplaySettings) => void };

const labelOf = (d: DisplaySettings, key: string, fallback: string) => d.fieldLabels[key]?.trim() || fallback;

/** Checklist of registration fields with a live preview of the page they produce. */
function CustomiseDialog({ d, set, open, onOpenChange }: Props & { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [query, setQuery] = useState("");
  const hidden = new Set(d.hiddenFields);
  const visible = REGISTRATION_FIELDS.filter((f) => !hidden.has(f.key));
  const order = new Map(visible.map((f, i) => [f.key, i + 1]));
  const list = REGISTRATION_FIELDS.filter((f) =>
    labelOf(d, f.key, f.label).toLowerCase().includes(query.trim().toLowerCase()),
  );
  const toggle = (key: string, on: boolean) =>
    set({ ...d, hiddenFields: on ? d.hiddenFields.filter((k) => k !== key) : [...d.hiddenFields, key] });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="border-b p-4">
          <DialogTitle>Customise Registration Page</DialogTitle>
          <DialogDescription className="sr-only">Choose which fields appear on the registration page.</DialogDescription>
        </DialogHeader>
        <div className="grid h-[60vh] md:grid-cols-[18rem_1fr]">
          <div className="flex min-h-0 flex-col gap-2 border-r p-4">
            <div className="relative">
              <SearchIcon className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
              <Input className="pl-8" placeholder="Search by field name" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-1">
              {list.map((f) => {
                const on = !hidden.has(f.key);
                return (
                  <label
                    key={f.key}
                    className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm ${on ? "border-primary/40 bg-primary/10" : "border-transparent"} ${f.locked ? "cursor-not-allowed" : "cursor-pointer"}`}
                    title={f.locked ? "Always shown" : undefined}
                  >
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={on}
                      disabled={f.locked}
                      onChange={(e) => toggle(f.key, e.target.checked)}
                    />
                    <span className="flex-1">{labelOf(d, f.key, f.label)}</span>
                    {on && (
                      <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
                        {order.get(f.key)}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>
          <div className="overflow-y-auto p-4">
            <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
              {visible.map((f) => (
                <div key={f.key} className="flex flex-col gap-1.5">
                  <span className="text-xs text-muted-foreground">
                    {labelOf(d, f.key, f.label)}
                    {(f.locked && f.key !== "patientId") || d.requiredFields.includes(f.key) ? <span className="text-destructive"> *</span> : null}
                  </span>
                  {f.key === "patientId" ? (
                    <span className="font-semibold">Auto-generated</span>
                  ) : f.key === "sex" ? (
                    <span className="flex gap-3 pt-1.5 text-sm">
                      <span>○ Male</span><span>○ Female</span><span>○ Other</span>
                    </span>
                  ) : f.key === "phoneBelongsTo" ? (
                    <span className="flex gap-3 pt-1.5 text-sm"><span>○ Patient</span><span>○ Relative/Guardian</span></span>
                  ) : (
                    <Input disabled placeholder={labelOf(d, f.key, f.label)} />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter className="border-t p-4">
          <Button type="button" variant="outline" onClick={() => set({ ...d, hiddenFields: [] })}>Show all</Button>
          <Button type="button" onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Lets the lab give any registration field its own label. */
function RenameDialog({ d, set, open, onOpenChange }: Props & { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="border-b p-4">
          <DialogTitle>Rename Fields</DialogTitle>
          <DialogDescription>Leave a box empty to keep the default name.</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[60vh] gap-x-6 gap-y-3 overflow-y-auto p-4 sm:grid-cols-2">
          {REGISTRATION_FIELDS.map((f) => (
            <label key={f.key} className="flex flex-col gap-1.5 text-sm">
              <span className="text-xs text-muted-foreground">{f.label}</span>
              <Input
                value={d.fieldLabels[f.key] ?? ""}
                placeholder={f.label}
                onChange={(e) => set({ ...d, fieldLabels: { ...d.fieldLabels, [f.key]: e.target.value } })}
              />
            </label>
          ))}
        </div>
        <DialogFooter className="border-t p-4">
          <Button type="button" variant="outline" onClick={() => set({ ...d, fieldLabels: {} })}>Reset names</Button>
          <Button type="button" onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CustomiseButtons({ d, set }: Props) {
  const [customise, setCustomise] = useState(false);
  const [rename, setRename] = useState(false);
  return (
    <div className="flex flex-wrap gap-3 border-y py-4">
      <Button type="button" variant="outline" className="border-primary text-primary" onClick={() => setCustomise(true)}>
        <PencilIcon /> Customise Registration Page
      </Button>
      <Button type="button" variant="outline" className="border-primary text-primary" onClick={() => setRename(true)}>
        <PencilIcon /> Rename Fields
      </Button>
      <CustomiseDialog d={d} set={set} open={customise} onOpenChange={setCustomise} />
      <RenameDialog d={d} set={set} open={rename} onOpenChange={setRename} />
    </div>
  );
}
