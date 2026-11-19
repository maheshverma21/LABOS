"use client";

import { useFormContext, useWatch } from "react-hook-form";
import { formatAgeBand, formatRange, sampleTypeLabel, type ParameterInput, type ReferenceRangeInput } from "@lms/shared";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useDepartments, useTests } from "@/lib/catalog";
import { cn } from "@/lib/utils";
import type { TestFormValues } from "./form-types";

const SEX_LABEL = { ANY: "", MALE: "Male", FEMALE: "Female" } as const;

/** One line per reference range, e.g. "Male (18 years and over): 13.0 - 17.0". */
function rangeLines(p: ParameterInput): string[] {
  if (p.resultType === "OPTIONS") return (p.options ?? []).length ? [`Options: ${(p.options ?? []).join(" / ")}`] : [];
  if (p.formula) return ["Calculated"];
  const ranges = (p.ranges ?? []) as ReferenceRangeInput[];
  const lines = ranges
    .map((r) => {
      const value = formatRange(
        { low: r.low ?? null, high: r.high ?? null, text: r.text || null },
        p.decimals ?? 1,
      );
      if (!value) return null;
      const who = [
        r.sex ? SEX_LABEL[r.sex] : "",
        r.ageMinDays != null || r.ageMaxDays != null ? formatAgeBand(r.ageMinDays ?? null, r.ageMaxDays ?? null) : "",
      ]
        .filter(Boolean)
        .join(", ");
      return ranges.length > 1 && who ? `${who}: ${value}` : value;
    })
    .filter((l): l is string => !!l);
  return lines;
}

/** A modal showing how this test will read on a printed report, using what is typed in the editor right now. */
export function TestPreviewDialog({ open, onOpenChange, panel }: { open: boolean; onOpenChange: (o: boolean) => void; panel: boolean }) {
  const { control } = useFormContext<TestFormValues>();
  const v = useWatch({ control });
  const departments = useDepartments();
  const all = useTests({ includeInactive: true });
  const department = departments.data?.find((d) => d.id === v.departmentId)?.name ?? "Department";
  const parameters = ((v.parameters ?? []) as ParameterInput[]).filter((p) => p?.name?.trim());
  const culture = v.reportKind === "CULTURE" && !panel;
  const members = (v.panelTestIds ?? []).map((id) => all.data?.find((t) => t.id === id)).filter((t) => !!t);

  const th = "px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-neutral-600";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] gap-3 overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Report preview</DialogTitle>
          <DialogDescription>How this {panel ? "panel" : "test"} will print, with the values you have entered so far. Results below are samples.</DialogDescription>
        </DialogHeader>

        {/* The sheet is always paper-white, like the printed report. */}
        <div className="rounded-lg border bg-white p-6 text-[13px] leading-snug text-neutral-900 shadow-inner">
          <div className="mb-4 text-center">
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-neutral-600">{department}</div>
            <div className="mt-1 text-base font-semibold">{v.name?.trim() || (panel ? "Panel name" : "Test name")}</div>
            <div className="mt-0.5 text-xs text-neutral-500">
              {[v.code?.trim(), v.sampleType ? sampleTypeLabel(v.sampleType) : "", v.method?.trim() ? `Method: ${v.method.trim()}` : ""]
                .filter(Boolean)
                .join("  ·  ")}
            </div>
          </div>

          {panel ? (
            <div>
              <div className="border-b border-neutral-900 pb-1 text-[11px] font-semibold uppercase tracking-wide">Tests in this profile</div>
              <ol className="list-decimal space-y-1 py-2 pl-6">
                {members.length === 0 && <li className="list-none text-neutral-500">No tests added yet.</li>}
                {members.map((t) => (
                  <li key={t!.id}>{t!.name}</li>
                ))}
              </ol>
            </div>
          ) : culture ? (
            <div className="space-y-2">
              <div className="border-b border-neutral-900 pb-1 text-[11px] font-semibold uppercase tracking-wide">Culture &amp; sensitivity</div>
              <p className="text-neutral-600">{v.cultureConfig?.noGrowthText || "No growth wording not set."}</p>
              <p className="text-neutral-500">
                Antibiotics: {(v.cultureConfig?.antibiotics ?? []).map((a) => a?.name).filter(Boolean).join(", ") || "none added"}
              </p>
            </div>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-neutral-900">
                  <th className={cn(th, "w-8")}>#</th>
                  <th className={th}>Parameter</th>
                  <th className={th}>Result</th>
                  <th className={th}>Unit</th>
                  <th className={th}>Reference range</th>
                </tr>
              </thead>
              <tbody>
                {parameters.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-2 py-4 text-center text-neutral-500">
                      Add a parameter to see it here.
                    </td>
                  </tr>
                )}
                {parameters.map((p, i) => {
                  const lines = rangeLines(p);
                  return (
                    <tr key={i} className="border-b border-neutral-200 align-top">
                      <td className="px-2 py-1.5 tabular-nums text-neutral-500">{i + 1}</td>
                      <td className="px-2 py-1.5">
                        <div className="font-medium">{p.name}</div>
                        {p.method?.trim() && <div className="text-[11px] text-neutral-500">Method: {p.method.trim()}</div>}
                      </td>
                      <td className="px-2 py-1.5 text-neutral-400">{p.resultType === "NUMERIC" ? "0." + "0".repeat(p.decimals ?? 1) : "—"}</td>
                      <td className="px-2 py-1.5">{p.unit?.trim() || ""}</td>
                      <td className="px-2 py-1.5">
                        {lines.length ? lines.map((l, j) => <div key={j}>{l}</div>) : <span className="text-neutral-400">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {v.reportNotes?.trim() && (
            <p className="mt-3 whitespace-pre-line text-xs text-neutral-600">
              <span className="font-semibold">Note: </span>
              {v.reportNotes.trim()}
            </p>
          )}
          {v.interpretation?.trim() && (
            <div className="mt-4 rounded-md border border-neutral-200 bg-neutral-50 p-3">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-600">Interpretation</div>
              <p className="whitespace-pre-line text-xs">{v.interpretation.trim()}</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
