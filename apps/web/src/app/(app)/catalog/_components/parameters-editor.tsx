"use client";

import { useState } from "react";
import { Controller, useFieldArray, useFormContext, useWatch } from "react-hook-form";
import { ArrowDownIcon, ArrowUpIcon, ChevronRightIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { RESULT_TYPES, type ResultType } from "@lms/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { blankParameter, type TestFormValues } from "./form-types";
import { RangesEditor } from "./ranges-editor";

const TYPE_LABEL: Record<ResultType, string> = { NUMERIC: "Number", TEXT: "Free text", OPTIONS: "Pick from list" };

/** Comma-separated options, kept as typed so commas and spaces don't jump around. */
function OptionsInput({
  value,
  onChange,
  invalid,
}: {
  value: string[] | undefined;
  onChange: (v: string[]) => void;
  invalid?: boolean;
}) {
  const [text, setText] = useState((value ?? []).join(", "));
  return (
    <Input
      aria-invalid={invalid}
      placeholder="Negative, Positive"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(
          e.target.value
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        );
      }}
    />
  );
}

function ParameterRow({
  index,
  count,
  defaultOpen,
  onMove,
  onRemove,
}: {
  index: number;
  count: number;
  defaultOpen: boolean;
  onMove: (to: number) => void;
  onRemove: () => void;
}) {
  const { control, register, formState } = useFormContext<TestFormValues>();
  const [open, setOpen] = useState(defaultOpen);
  const path = `parameters.${index}` as const;
  const err = formState.errors.parameters?.[index];
  const resultType = useWatch({ control, name: `${path}.resultType` }) ?? "NUMERIC";
  const rangeCount = useWatch({ control, name: `${path}.ranges` })?.length ?? 0;
  const formula = useWatch({ control, name: `${path}.formula` });
  const numeric = resultType === "NUMERIC";

  // Errors hidden inside the collapsed area force it open.
  const detailError = !!(err?.ranges || err?.options || err?.formula);
  const isOpen = open || detailError;

  return (
    <Collapsible open={isOpen} onOpenChange={setOpen} className="rounded-xl border bg-card shadow-xs">
      <div className="flex items-start gap-3 p-3">
        {/* Serial number with move controls */}
        <div className="flex w-9 shrink-0 flex-col items-center gap-0.5 pt-5">
          <Button type="button" variant="ghost" size="icon" className="size-6" aria-label="Move up" disabled={index === 0} onClick={() => onMove(index - 1)}>
            <ArrowUpIcon />
          </Button>
          <span className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold tabular-nums text-primary" aria-label={`Parameter ${index + 1}`}>
            {index + 1}
          </span>
          <Button type="button" variant="ghost" size="icon" className="size-6" aria-label="Move down" disabled={index === count - 1} onClick={() => onMove(index + 1)}>
            <ArrowDownIcon />
          </Button>
        </div>

        <div className="grid flex-1 grid-cols-2 gap-x-3 gap-y-3 md:grid-cols-12">
          <Field data-invalid={!!err?.code} className="md:col-span-2">
            <FieldLabel>Code</FieldLabel>
            <Input aria-label="Code" placeholder="e.g. HB" className="font-mono uppercase" aria-invalid={!!err?.code} {...register(`${path}.code`)} />
          </Field>
          <Field data-invalid={!!err?.name} className="col-span-2 md:col-span-6">
            <FieldLabel>Parameter name</FieldLabel>
            <Input aria-label="Parameter name" placeholder="e.g. Haemoglobin" aria-invalid={!!err?.name} {...register(`${path}.name`)} />
          </Field>
          <Field className="md:col-span-2">
            <FieldLabel>Unit</FieldLabel>
            <Input aria-label="Unit" placeholder="e.g. g/dL" {...register(`${path}.unit`)} />
          </Field>
          <Field className="md:col-span-2">
            <FieldLabel>Result type</FieldLabel>
            <Controller
              control={control}
              name={`${path}.resultType`}
              render={({ field }) => (
                <Select value={field.value ?? "NUMERIC"} onValueChange={field.onChange}>
                  <SelectTrigger aria-label="Result type" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RESULT_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {TYPE_LABEL[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          <Field className="col-span-2 md:col-span-8">
            <FieldLabel>Method</FieldLabel>
            <Input aria-label="Method" placeholder="e.g. Photometry, CLIA, HPLC (printed under the parameter on the report)" {...register(`${path}.method`)} />
          </Field>
          {numeric && (
            <Field className="md:col-span-2">
              <FieldLabel>Decimals</FieldLabel>
              <Controller
                control={control}
                name={`${path}.decimals`}
                render={({ field }) => (
                  <Select value={String(field.value ?? 1)} onValueChange={(v) => field.onChange(Number(v))}>
                    <SelectTrigger aria-label="Decimal places" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[0, 1, 2, 3, 4].map((d) => (
                        <SelectItem key={d} value={String(d)}>
                          {d} dp
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
          )}
        </div>

        <div className="flex items-center gap-1 pt-5">
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" size="sm" aria-label="Ranges and options">
              <ChevronRightIcon className={cn("transition-transform", isOpen && "rotate-90")} />
              <span className="hidden sm:inline">
                {formula ? "Calculated" : `${rangeCount} ${rangeCount === 1 ? "range" : "ranges"}`}
              </span>
            </Button>
          </CollapsibleTrigger>
          <Button type="button" variant="ghost" size="icon" aria-label="Remove parameter" onClick={onRemove}>
            <Trash2Icon />
          </Button>
        </div>
      </div>

      {(err?.code || err?.name) && (
        <p className="px-14 pb-2 text-sm text-destructive">{err.code?.message ?? err.name?.message}</p>
      )}

      <CollapsibleContent className="space-y-4 rounded-b-xl border-t bg-muted/30 p-4 sm:pl-16">
        {resultType === "OPTIONS" && (
          <Field data-invalid={!!err?.options}>
            <FieldLabel>Options</FieldLabel>
            <Controller
              control={control}
              name={`${path}.options`}
              render={({ field }) => (
                <OptionsInput value={field.value} onChange={field.onChange} invalid={!!err?.options} />
              )}
            />
            {err?.options ? (
              <FieldError>{err.options.message}</FieldError>
            ) : (
              <FieldDescription>Separate with commas. The technician picks one when entering results.</FieldDescription>
            )}
          </Field>
        )}
        {numeric && (
          <Field data-invalid={!!err?.formula}>
            <FieldLabel>Formula (optional)</FieldLabel>
            <Input
              placeholder="e.g. TCHOL - HDL - TG / 5"
              className="font-mono"
              aria-invalid={!!err?.formula}
              {...register(`${path}.formula`)}
            />
            {err?.formula ? (
              <FieldError>{err.formula.message}</FieldError>
            ) : (
              <FieldDescription>Calculated from other parameters in this test, using their codes.</FieldDescription>
            )}
          </Field>
        )}
        <div className="space-y-2">
          <div className="text-sm font-medium">Reference ranges</div>
          <RangesEditor paramIndex={index} numeric={numeric} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function ParametersEditor() {
  const { control, formState } = useFormContext<TestFormValues>();
  // keyName avoids a clash with the parameters' own `id` field.
  const { fields, append, remove, move } = useFieldArray({ control, name: "parameters", keyName: "_key" });
  const rootError = formState.errors.parameters?.root ?? formState.errors.parameters;

  return (
    <div className="space-y-3">
      {fields.map((f, i) => (
        <ParameterRow
          key={f._key}
          index={i}
          count={fields.length}
          defaultOpen={!f.id && fields.length === 1}
          onMove={(to) => move(i, to)}
          onRemove={() => remove(i)}
        />
      ))}
      {rootError && "message" in rootError && rootError.message && (
        <p className="text-sm text-destructive">{String(rootError.message)}</p>
      )}
      <Button type="button" variant="outline" onClick={() => append(blankParameter())}>
        <PlusIcon /> Add parameter
      </Button>
      {fields.some((f) => f.id) && (
        <p className="text-xs text-muted-foreground">
          <Badge variant="outline" className="mr-1">
            Note
          </Badge>
          Removing a parameter hides it from new orders; results already reported keep it.
        </p>
      )}
    </div>
  );
}
