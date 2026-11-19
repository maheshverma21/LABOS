"use client";

import { PlusIcon, Trash2Icon } from "lucide-react";
import {
  COLONY_COUNT_PRESETS,
  ORGANISM_PRESETS,
  SENSITIVITY_LABEL,
  SENSITIVITY_RESULTS,
  type CultureConfig,
  type CultureOutcome,
  type CultureResult,
  type CultureResultInput,
  type SensitivityResult,
} from "@lms/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/** What the technician has typed so far. Antibiotics are keyed by name so the grid stays in the test's order. */
export interface CultureState {
  outcome: CultureOutcome | null;
  noGrowthText: string;
  microscopy: string;
  organisms: { name: string; colonyCount: string; sens: Record<string, { result: SensitivityResult | ""; measure: string }> }[];
}

export const blankOrganism = (): CultureState["organisms"][number] => ({ name: "", colonyCount: "", sens: {} });

export function initCultureState(config: CultureConfig, data: CultureResult | null): CultureState {
  return {
    outcome: data?.outcome ?? null,
    noGrowthText: data?.noGrowthText ?? config.noGrowthText,
    microscopy: data?.microscopy ?? "",
    organisms: (data?.organisms ?? []).map((o) => ({
      name: o.name,
      colonyCount: o.colonyCount ?? "",
      sens: Object.fromEntries(o.sensitivities.map((s) => [s.antibiotic, { result: s.result, measure: s.measure ?? "" }])),
    })),
  };
}

/** The request body for the API, or undefined while no outcome has been chosen. Ordered by the test's antibiotic list. */
export function cultureToPayload(state: CultureState, config: CultureConfig): CultureResultInput | undefined {
  if (!state.outcome) return undefined;
  const order = antibioticNames(config, state);
  const base = { outcome: state.outcome, microscopy: state.microscopy || null };
  if (state.outcome === "NO_GROWTH") return { ...base, noGrowthText: state.noGrowthText || null, organisms: [] };
  return {
    ...base,
    organisms: state.organisms.map((o) => ({
      name: o.name,
      colonyCount: o.colonyCount || null,
      sensitivities: order
        .filter((a) => o.sens[a]?.result)
        .map((a) => ({ antibiotic: a, result: o.sens[a]!.result as SensitivityResult, measure: o.sens[a]!.measure || null })),
    })),
  };
}

/** The test's antibiotics, plus any on a saved result that have since been removed from the list. */
function antibioticNames(config: CultureConfig, state: CultureState) {
  const names = config.antibiotics.map((a) => a.name);
  for (const o of state.organisms) for (const k of Object.keys(o.sens)) if (!names.includes(k)) names.push(k);
  return names;
}

const SIR_STYLE: Record<SensitivityResult, string> = {
  S: "bg-emerald-600 text-white border-emerald-600",
  I: "bg-amber-500 text-white border-amber-500",
  R: "bg-red-600 text-white border-red-600",
  SDD: "bg-amber-500 text-white border-amber-500",
};

export function CultureEntry({
  config,
  state,
  onChange,
  editable,
  error,
  idPrefix,
}: {
  config: CultureConfig;
  state: CultureState;
  onChange: (next: CultureState) => void;
  editable: boolean;
  error?: string;
  idPrefix: string;
}) {
  const names = antibioticNames(config, state);
  const setOrganism = (i: number, patch: Partial<CultureState["organisms"][number]>) =>
    onChange({ ...state, organisms: state.organisms.map((o, j) => (j === i ? { ...o, ...patch } : o)) });
  const setSens = (i: number, ab: string, patch: Partial<{ result: SensitivityResult | ""; measure: string }>) =>
    setOrganism(i, { sens: { ...state.organisms[i]!.sens, [ab]: { result: state.organisms[i]!.sens[ab]?.result ?? "", measure: state.organisms[i]!.sens[ab]?.measure ?? "", ...patch } } });

  const choose = (outcome: CultureOutcome) =>
    onChange({
      ...state,
      outcome,
      organisms: outcome === "GROWTH" && state.organisms.length === 0 ? [blankOrganism()] : state.organisms,
    });

  return (
    <div className="space-y-4">
      <div className="grid gap-1.5">
        <Label htmlFor={`${idPrefix}-micro`}>Direct smear / Gram stain (optional)</Label>
        <Textarea
          id={`${idPrefix}-micro`}
          rows={2}
          disabled={!editable}
          placeholder="e.g. Pus cells 10-15 / HPF; Gram-negative bacilli seen"
          value={state.microscopy}
          onChange={(e) => onChange({ ...state, microscopy: e.target.value })}
        />
      </div>

      <div className="grid gap-1.5">
        <Label>Culture result</Label>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Culture result">
          {(["NO_GROWTH", "GROWTH"] as const).map((o) => (
            <Button
              key={o}
              type="button"
              role="radio"
              aria-checked={state.outcome === o}
              disabled={!editable}
              variant={state.outcome === o ? "default" : "outline"}
              onClick={() => choose(o)}
            >
              {o === "NO_GROWTH" ? "No growth" : "Growth of organism(s)"}
            </Button>
          ))}
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>

      {state.outcome === "NO_GROWTH" && (
        <div className="grid gap-1.5">
          <Label htmlFor={`${idPrefix}-ng`}>Wording on the report</Label>
          <Textarea
            id={`${idPrefix}-ng`}
            rows={2}
            disabled={!editable}
            value={state.noGrowthText}
            onChange={(e) => onChange({ ...state, noGrowthText: e.target.value })}
          />
          {editable && state.noGrowthText !== config.noGrowthText && (
            <button type="button" className="w-fit text-xs text-muted-foreground underline underline-offset-4" onClick={() => onChange({ ...state, noGrowthText: config.noGrowthText })}>
              Reset to the test&apos;s template
            </button>
          )}
        </div>
      )}

      {state.outcome === "GROWTH" && (
        <div className="space-y-4">
          <datalist id={`${idPrefix}-orgs`}>
            {ORGANISM_PRESETS.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
          <datalist id={`${idPrefix}-counts`}>
            {COLONY_COUNT_PRESETS.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>

          {state.organisms.map((o, i) => {
            const reported = names.filter((a) => o.sens[a]?.result).length;
            return (
              <div key={i} className="space-y-3 rounded-lg border p-3">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="grid min-w-56 flex-1 gap-1.5">
                    <Label htmlFor={`${idPrefix}-org-${i}`}>{state.organisms.length > 1 ? `Organism ${i + 1}` : "Organism isolated"}</Label>
                    <Input
                      id={`${idPrefix}-org-${i}`}
                      list={`${idPrefix}-orgs`}
                      autoComplete="off"
                      disabled={!editable}
                      placeholder="Type or pick, e.g. Escherichia coli"
                      value={o.name}
                      onChange={(e) => setOrganism(i, { name: e.target.value })}
                    />
                  </div>
                  <div className="grid w-full gap-1.5 sm:w-64">
                    <Label htmlFor={`${idPrefix}-cnt-${i}`}>Colony count</Label>
                    <Input
                      id={`${idPrefix}-cnt-${i}`}
                      list={`${idPrefix}-counts`}
                      autoComplete="off"
                      disabled={!editable}
                      value={o.colonyCount}
                      onChange={(e) => setOrganism(i, { colonyCount: e.target.value })}
                    />
                  </div>
                  {editable && state.organisms.length > 1 && (
                    <Button type="button" variant="ghost" size="icon" aria-label={`Remove organism ${i + 1}`} onClick={() => onChange({ ...state, organisms: state.organisms.filter((_, j) => j !== i) })}>
                      <Trash2Icon />
                    </Button>
                  )}
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm sm:min-w-[32rem]">
                    <thead className="text-left text-xs text-muted-foreground">
                      <tr className="border-b [&>th]:py-1.5 [&>th]:pr-3 [&>th]:font-medium">
                        <th>Antibiotic</th>
                        {config.showMeasure && <th className="w-28">Zone mm / MIC</th>}
                        <th className="w-64">
                          Interpretation <span className="font-normal">({reported} of {names.length} reported)</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {names.map((ab) => {
                        const cur = o.sens[ab];
                        return (
                          <tr key={ab} className="border-b last:border-0 [&>td]:py-1 [&>td]:pr-3">
                            <td className={cn(cur?.result === "R" && "font-semibold")}>{ab}</td>
                            {config.showMeasure && (
                              <td>
                                <Input
                                  aria-label={`${ab} zone or MIC`}
                                  className="h-8 w-24 tabular-nums"
                                  autoComplete="off"
                                  disabled={!editable}
                                  value={cur?.measure ?? ""}
                                  onChange={(e) => setSens(i, ab, { measure: e.target.value })}
                                />
                              </td>
                            )}
                            <td>
                              <div className="flex gap-1" role="radiogroup" aria-label={`${ab} interpretation`}>
                                {SENSITIVITY_RESULTS.map((r) => (
                                  <button
                                    key={r}
                                    type="button"
                                    role="radio"
                                    aria-checked={cur?.result === r}
                                    title={SENSITIVITY_LABEL[r]}
                                    disabled={!editable}
                                    className={cn(
                                      "h-8 min-w-10 rounded-md border px-2 text-xs font-semibold transition-colors disabled:cursor-default",
                                      cur?.result === r ? SIR_STYLE[r] : "bg-transparent text-muted-foreground hover:bg-muted disabled:hover:bg-transparent",
                                    )}
                                    // Clicking the chosen one again clears it, so the drug is left off the report.
                                    onClick={() => setSens(i, ab, { result: cur?.result === r ? "" : r })}
                                  >
                                    {r}
                                  </button>
                                ))}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-muted-foreground">S sensitive · I intermediate · R resistant · SDD susceptible, dose dependent. Antibiotics left blank are not printed.</p>
              </div>
            );
          })}

          {editable && state.organisms.length < 6 && (
            <Button type="button" variant="outline" size="sm" onClick={() => onChange({ ...state, organisms: [...state.organisms, blankOrganism()] })}>
              <PlusIcon /> Add another organism
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
