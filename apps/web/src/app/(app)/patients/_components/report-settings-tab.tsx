"use client";

import { useState } from "react";
import { PencilIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { REPORT_HEADER_FIELDS, type ReportHeaderSettings } from "@lms/shared";

type Props = { value: ReportHeaderSettings; onChange: (next: ReportHeaderSettings) => void };

const labelOf = (v: ReportHeaderSettings, key: string, fallback: string) => v.labels[key]?.trim() || fallback;

/** Lets the lab give any report detail its own label. */
function LabelsDialog({ value, onChange, open, onOpenChange }: Props & { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="border-b p-4">
          <DialogTitle>Customise Labels</DialogTitle>
          <DialogDescription>The name each detail prints with on the report. Leave a box empty to keep the default.</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[60vh] gap-x-6 gap-y-3 overflow-y-auto p-4 sm:grid-cols-2">
          {REPORT_HEADER_FIELDS.map((f) => (
            <label key={f.key} className="flex flex-col gap-1.5 text-sm">
              <span className="text-xs text-muted-foreground">{f.label}</span>
              <Input
                value={value.labels[f.key] ?? ""}
                placeholder={f.label}
                maxLength={40}
                onChange={(e) => onChange({ ...value, labels: { ...value.labels, [f.key]: e.target.value } })}
              />
            </label>
          ))}
        </div>
        <DialogFooter className="border-t p-4">
          <Button type="button" variant="outline" onClick={() => onChange({ ...value, labels: {} })}>Reset labels</Button>
          <Button type="button" onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Report Setting" tab: pick the patient and order details printed at the top of
 * a report. The number on a chip is where it prints. This changes reports only,
 * not the registration page.
 */
export function ReportSettingsTab({ value, onChange }: Props) {
  const [labels, setLabels] = useState(false);
  const toggle = (key: (typeof REPORT_HEADER_FIELDS)[number]["key"]) =>
    onChange({ ...value, fields: value.fields.includes(key) ? value.fields.filter((k) => k !== key) : [...value.fields, key] });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-medium">Report Ordering</h3>
        <p className="text-xs text-muted-foreground">
          Choose the details printed at the top of the report. They print in the order you pick them (see the numbers); this affects reports only.
        </p>
      </div>
      <div className="flex flex-wrap gap-3 rounded-md border p-4">
        {REPORT_HEADER_FIELDS.map((f) => {
          const pos = value.fields.indexOf(f.key);
          const on = pos >= 0;
          return (
            <button
              key={f.key}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(f.key)}
              className={`relative rounded-md border px-3 py-1.5 text-sm transition-colors ${on ? "border-primary/50 bg-primary/10 text-primary" : "bg-muted/40 hover:border-primary/40"}`}
            >
              {labelOf(value, f.key, f.label)}
              {on && (
                <span className="absolute -top-2 -right-2 flex size-5 items-center justify-center rounded-full bg-primary text-[11px] font-medium text-primary-foreground">
                  {pos + 1}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {value.fields.length === 0 && <p className="text-sm text-destructive">Pick at least one detail to print on the report.</p>}
      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="outline" className="border-destructive text-destructive hover:text-destructive" onClick={() => onChange({ ...value, fields: [] })}>
          <Trash2Icon /> Clear All
        </Button>
        <Button type="button" variant="outline" className="border-primary text-primary" onClick={() => setLabels(true)}>
          <PencilIcon /> Customise Labels
        </Button>
      </div>
      <LabelsDialog value={value} onChange={onChange} open={labels} onOpenChange={setLabels} />
    </div>
  );
}
