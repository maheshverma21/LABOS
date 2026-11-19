"use client";

import { useState } from "react";
import { Controller, useFormContext } from "react-hook-form";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, XIcon } from "lucide-react";
import {
  ANTIBIOTIC_GROUPS,
  ANTIBIOTIC_PANELS,
  DEFAULT_SENSITIVITY_FOOTNOTE,
  noGrowthTemplateFor,
  type CultureConfigInput,
} from "@lms/shared";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { TestFormValues } from "./form-types";

type Antibiotic = NonNullable<CultureConfigInput["antibiotics"]>[number];

/** Antibiotics, no-growth wording and footnote for a culture & sensitivity test. */
export function CultureConfigEditor() {
  const { control, watch, setValue, formState } = useFormContext<TestFormValues>();
  const config = watch("cultureConfig");
  const sampleType = watch("sampleType");
  const [custom, setCustom] = useState("");
  const [panelKey, setPanelKey] = useState("");
  if (!config) return null;

  const list = (config.antibiotics ?? []) as Antibiotic[];
  const cfgErrors = formState.errors.cultureConfig as
    | { antibiotics?: { message?: string } & Record<number, { name?: { message?: string } }>; noGrowthText?: { message?: string } }
    | undefined;

  const update = (patch: Partial<CultureConfigInput>) =>
    setValue("cultureConfig", { ...config, ...patch }, { shouldDirty: true, shouldValidate: formState.isSubmitted });
  const setList = (next: Antibiotic[]) => update({ antibiotics: next });
  const has = (name: string) => list.some((a) => a.name.toLowerCase() === name.toLowerCase());

  const add = (name: string, group: string | null = null) => {
    const n = name.trim();
    if (!n || has(n)) return;
    const preset = ANTIBIOTIC_GROUPS.flatMap((g) => g.items).find((a) => a.name.toLowerCase() === n.toLowerCase());
    setList([...list, { name: preset?.name ?? n, group: preset?.group ?? group }]);
  };
  const addPanel = (key: string) => {
    const panel = ANTIBIOTIC_PANELS.find((p) => p.key === key);
    if (!panel) return;
    setList([...list, ...panel.items.filter((a) => !has(a.name)).map((a) => ({ ...a }))]);
    setPanelKey("");
  };
  const move = (from: number, to: number) => {
    const next = [...list];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    setList(next);
  };

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <Field className="w-full sm:w-72">
            <FieldLabel htmlFor="ab-panel">Add a ready-made list</FieldLabel>
            <Select value={panelKey || undefined} onValueChange={addPanel}>
              <SelectTrigger id="ab-panel" className="w-full">
                <SelectValue placeholder="Choose a specimen / organism type" />
              </SelectTrigger>
              <SelectContent>
                {ANTIBIOTIC_PANELS.map((p) => (
                  <SelectItem key={p.key} value={p.key}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field className="min-w-56 flex-1">
            <FieldLabel htmlFor="ab-add">Add an antibiotic</FieldLabel>
            <div className="flex gap-2">
              <Input
                id="ab-add"
                list="ab-presets"
                autoComplete="off"
                placeholder="Type or pick, e.g. Meropenem"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    add(custom);
                    setCustom("");
                  }
                }}
              />
              <datalist id="ab-presets">
                {ANTIBIOTIC_GROUPS.flatMap((g) => g.items)
                  .filter((a) => !has(a.name))
                  .map((a) => (
                    <option key={a.name} value={a.name} />
                  ))}
              </datalist>
              <Button
                type="button"
                variant="outline"
                disabled={!custom.trim()}
                onClick={() => {
                  add(custom);
                  setCustom("");
                }}
              >
                <PlusIcon /> Add
              </Button>
            </div>
          </Field>
          {list.length > 0 && (
            <Button type="button" variant="ghost" onClick={() => setList([])}>
              Clear list
            </Button>
          )}
        </div>

        {list.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            No antibiotics yet. Pick a ready-made list above, or add them one by one.
          </p>
        ) : (
          <ol className="divide-y rounded-lg border">
            {list.map((a, i) => (
              <li key={a.name} className="flex items-center gap-2 px-2 py-1 text-sm">
                <span className="w-6 text-right text-muted-foreground tabular-nums">{i + 1}.</span>
                <span className="flex-1">{a.name}</span>
                {a.group && <span className="hidden text-xs text-muted-foreground sm:inline">{a.group}</span>}
                <Button type="button" variant="ghost" size="icon" className="size-7" aria-label="Move up" disabled={i === 0} onClick={() => move(i, i - 1)}>
                  <ArrowUpIcon />
                </Button>
                <Button type="button" variant="ghost" size="icon" className="size-7" aria-label="Move down" disabled={i === list.length - 1} onClick={() => move(i, i + 1)}>
                  <ArrowDownIcon />
                </Button>
                <Button type="button" variant="ghost" size="icon" className="size-7" aria-label={`Remove ${a.name}`} onClick={() => setList(list.filter((_, j) => j !== i))}>
                  <XIcon />
                </Button>
              </li>
            ))}
          </ol>
        )}
        {cfgErrors?.antibiotics?.message && <p className="text-sm text-destructive">{cfgErrors.antibiotics.message}</p>}
        <p className="text-xs text-muted-foreground">
          At result entry the technician chooses S / I / R for each of these, only for the ones tested. Your microbiologist should review the list against current CLSI / EUCAST guidance.
        </p>
      </div>

      <Field data-invalid={!!cfgErrors?.noGrowthText}>
        <FieldLabel htmlFor="no-growth">No-growth report template</FieldLabel>
        <Textarea
          id="no-growth"
          rows={2}
          value={config.noGrowthText ?? ""}
          onChange={(e) => update({ noGrowthText: e.target.value })}
        />
        <div className="flex flex-wrap items-center gap-2">
          <FieldDescription className="flex-1">
            Printed when the result is &quot;No growth&quot;. The technician can edit it on each report.
          </FieldDescription>
          <Button type="button" variant="outline" size="sm" onClick={() => update({ noGrowthText: noGrowthTemplateFor(sampleType) })}>
            Use standard wording for this sample
          </Button>
        </div>
        {cfgErrors?.noGrowthText?.message && <FieldError errors={[cfgErrors.noGrowthText]} />}
      </Field>

      <Field>
        <FieldLabel htmlFor="ab-footnote">Note under the sensitivity table</FieldLabel>
        <Textarea
          id="ab-footnote"
          rows={2}
          value={config.footnote ?? ""}
          onChange={(e) => update({ footnote: e.target.value })}
        />
        <div className="flex flex-wrap items-center gap-2">
          <FieldDescription className="flex-1">Key and method, e.g. S / I / R and disk diffusion.</FieldDescription>
          <Button type="button" variant="outline" size="sm" onClick={() => update({ footnote: DEFAULT_SENSITIVITY_FOOTNOTE })}>
            Use standard note
          </Button>
        </div>
      </Field>

      <Controller
        control={control}
        name="cultureConfig.showMeasure"
        render={({ field }) => (
          <label className="flex items-center gap-3 text-sm">
            <Switch checked={field.value !== false} onCheckedChange={field.onChange} />
            Show a zone-of-inhibition (mm) / MIC column in the sensitivity table
          </label>
        )}
      />
    </div>
  );
}
