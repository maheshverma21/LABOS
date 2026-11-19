"use client";

import { Controller, useFieldArray, useFormContext, type FieldErrors } from "react-hook-form";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { SEXES, type ReferenceRangeInput } from "@lms/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AgeInput } from "@/components/inputs/age-input";
import { NumberInput } from "@/components/inputs/number-input";
import { blankRange, type TestFormValues } from "./form-types";

const SEX_LABEL = { ANY: "Any", MALE: "Male", FEMALE: "Female" } as const;
const LIMITS = [
  ["low", "Low"],
  ["high", "High"],
  ["criticalLow", "Critical low"],
  ["criticalHigh", "Critical high"],
] as const;

export function RangesEditor({ paramIndex, numeric }: { paramIndex: number; numeric: boolean }) {
  const { control, register, formState } = useFormContext<TestFormValues>();
  const { fields, append, remove } = useFieldArray({ control, name: `parameters.${paramIndex}.ranges` });
  const rangeErrors = formState.errors.parameters?.[paramIndex]?.ranges as
    | (FieldErrors<ReferenceRangeInput> | undefined)[]
    | undefined;

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[56rem] text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr className="[&>th]:px-2 [&>th]:py-1.5 [&>th]:text-left [&>th]:font-medium">
              <th className="w-24">Sex</th>
              <th>Age from</th>
              <th>Age under</th>
              {numeric && LIMITS.map(([, label]) => <th key={label}>{label}</th>)}
              <th>{numeric ? "Or text" : "Normal value"}</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {fields.map((f, i) => {
              const err = rangeErrors?.[i];
              const path = `parameters.${paramIndex}.ranges.${i}` as const;
              return (
                <tr key={f.id} className="border-t align-top [&>td]:p-1.5">
                  <td>
                    <Controller
                      control={control}
                      name={`${path}.sex`}
                      render={({ field }) => (
                        <Select value={field.value ?? "ANY"} onValueChange={field.onChange}>
                          <SelectTrigger className="w-24" aria-label="Sex">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {SEXES.map((s) => (
                              <SelectItem key={s} value={s}>
                                {SEX_LABEL[s]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </td>
                  <td>
                    <Controller
                      control={control}
                      name={`${path}.ageMinDays`}
                      render={({ field }) => (
                        <AgeInput aria-label="Age from" placeholder="Birth" value={field.value} onChange={field.onChange} />
                      )}
                    />
                  </td>
                  <td>
                    <Controller
                      control={control}
                      name={`${path}.ageMaxDays`}
                      render={({ field }) => (
                        <AgeInput
                          aria-label="Age under"
                          placeholder="No limit"
                          invalid={!!err?.ageMaxDays}
                          value={field.value}
                          onChange={field.onChange}
                        />
                      )}
                    />
                  </td>
                  {numeric &&
                    LIMITS.map(([key, label]) => (
                      <td key={key}>
                        <Controller
                          control={control}
                          name={`${path}.${key}`}
                          render={({ field }) => (
                            <NumberInput
                              aria-label={label}
                              aria-invalid={!!err?.[key]}
                              allowNegative
                              className="w-24"
                              value={field.value}
                              onChange={field.onChange}
                            />
                          )}
                        />
                      </td>
                    ))}
                  <td>
                    <Input
                      aria-label={numeric ? "Text range" : "Normal value"}
                      placeholder={numeric ? "e.g. < 200 desirable" : "e.g. Negative"}
                      className="min-w-36"
                      {...register(`${path}.text`)}
                    />
                  </td>
                  <td>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Remove range"
                      onClick={() => remove(i)}
                    >
                      <Trash2Icon />
                    </Button>
                  </td>
                </tr>
              );
            })}
            {fields.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-3 text-muted-foreground">
                  No reference range. Results will be reported without one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {rangeErrors?.some(Boolean) && (
        <ul className="space-y-0.5 text-sm text-destructive">
          {rangeErrors.map((e, i) =>
            e
              ? Object.values(e).map((fe, j) =>
                  fe && typeof fe === "object" && "message" in fe && fe.message ? (
                    <li key={`${i}-${j}`}>
                      Range {i + 1}: {String(fe.message)}
                    </li>
                  ) : null,
                )
              : null,
          )}
        </ul>
      )}

      <Button type="button" variant="outline" size="sm" onClick={() => append(blankRange())}>
        <PlusIcon /> Add range
      </Button>
    </div>
  );
}
