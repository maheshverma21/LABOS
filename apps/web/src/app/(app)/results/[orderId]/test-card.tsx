"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, MessageSquareWarningIcon, PrinterIcon, RotateCcwIcon, SendIcon, TriangleAlertIcon, CpuIcon } from "lucide-react";
import {
  evaluateFormula,
  FLAG_LABEL,
  flagFor,
  formatRange,
  isCritical,
  parseNumericResult,
  type ResultFlag,
  type ResultSheet,
  type ResultTest,
} from "@lms/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { TestStatusBadge } from "@/components/results/test-status-badge";
import { useAuth } from "@/providers/auth-provider";
import { api, ApiError } from "@/lib/api";
import { orderKeys } from "@/lib/orders";
import { resultKeys } from "@/lib/results";
import { cn } from "@/lib/utils";
import { useFlagColours } from "@/lib/branding";
import { NoteDialog } from "./note-dialog";
import { CultureEntry, cultureToPayload, initCultureState } from "./culture-entry";
import { OutsourcePanel, type OutsourceMode } from "./outsource-panel";

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "2-digit", timeZone: "Asia/Kolkata" });

/** Enter moves to the next result box on the page, like a spreadsheet. */
function focusNext(current: HTMLElement) {
  const all = [...document.querySelectorAll<HTMLElement>("[data-result-input]:not(:disabled)")];
  const i = all.indexOf(current);
  all[i + 1]?.focus();
  if (all[i + 1] instanceof HTMLInputElement) (all[i + 1] as HTMLInputElement).select();
}

function FlagMark({ flag }: { flag: ResultFlag | null }) {
  const colours = useFlagColours();
  if (!flag || flag === "NORMAL") return null;
  const up = flag === "HIGH" || flag === "CRITICAL_HIGH";
  return (
    <span
      className={cn("inline-flex items-center gap-0.5 text-xs font-semibold", isCritical(flag) && "underline decoration-2 underline-offset-2")}
      style={{ color: up ? colours.high : colours.low }}
      title={FLAG_LABEL[flag]}
    >
      {isCritical(flag) && <TriangleAlertIcon className="size-3.5" />}
      {up ? <ArrowUpIcon className="size-3.5" /> : <ArrowDownIcon className="size-3.5" />}
      {FLAG_LABEL[flag]}
    </span>
  );
}

export function TestCard({ test, sheet, onPrint }: { test: ResultTest; sheet: ResultSheet; onPrint?: () => void }) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(test.parameters.map((p) => [p.parameterId, p.value ?? ""])),
  );
  const cultureConfig = test.culture?.config ?? null;
  const [cultureState, setCultureState] = useState(() => (test.culture ? initCultureState(test.culture.config, test.culture.data) : null));
  const savedCulture = useMemo(
    () => (test.culture ? JSON.stringify(cultureToPayload(initCultureState(test.culture.config, test.culture.data), test.culture.config) ?? null) : null),
    [test.culture],
  );
  const culturePayload = cultureState && cultureConfig ? cultureToPayload(cultureState, cultureConfig) : undefined;
  const [remarks, setRemarks] = useState(test.remarks ?? "");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [dialog, setDialog] = useState<"send-back" | "reopen" | null>(null);
  const [mode, setMode] = useState<OutsourceMode>(test.outsourceFile ? "upload" : "manual");
  const uploadMode = !!test.outsourceLab && mode === "upload";

  const active = sheet.order.status === "ACTIVE";
  const editable = active && can("results:write") && ["IN_LAB", "ENTERED", "SUBMITTED"].includes(test.status);
  const approver = active && can("results:approve");
  const cultureDirty = !!test.culture && JSON.stringify(culturePayload ?? null) !== savedCulture;
  const dirty =
    cultureDirty ||
    remarks !== (test.remarks ?? "") || test.parameters.some((p) => !p.formula && (values[p.parameterId] ?? "") !== (p.value ?? ""));

  // Live calculated values, from what's typed now.
  const shown = useMemo(() => {
    const byCode: Record<string, number | null> = {};
    for (const p of test.parameters) if (!p.formula) byCode[p.code] = parseNumericResult(values[p.parameterId] ?? "");
    const out: Record<string, string> = { ...values };
    for (const p of test.parameters.filter((x) => x.formula)) {
      const n = evaluateFormula(p.formula!, byCode);
      byCode[p.code] = n;
      out[p.parameterId] = n == null ? "" : String(Math.round(n * 10 ** p.decimals) / 10 ** p.decimals);
    }
    return out;
  }, [values, test.parameters]);

  const afterChange = async (next?: ResultSheet) => {
    if (next) queryClient.setQueryData(resultKeys.sheet(sheet.order.id), next);
    else await queryClient.invalidateQueries({ queryKey: resultKeys.sheet(sheet.order.id) });
    await queryClient.invalidateQueries({ queryKey: [...resultKeys.all, "worklist"] });
    await queryClient.invalidateQueries({ queryKey: orderKeys.all });
  };

  const save = useMutation({
    mutationFn: (submit: boolean) =>
      api<{ sheet: ResultSheet }>(`/results/tests/${test.orderTestId}`, {
        method: "PUT",
        body: {
          values: Object.fromEntries(test.parameters.filter((p) => !p.formula).map((p) => [p.parameterId, values[p.parameterId] || null])),
          remarks: remarks || null,
          ...(test.culture && culturePayload ? { culture: culturePayload } : {}),
          submit,
        },
      }),
    onSuccess: async (r, submit) => {
      setFieldErrors({});
      toast.success(submit ? `${test.code} sent for approval` : `${test.code} saved`);
      await afterChange(r.sheet);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.fields) {
        setFieldErrors(Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [k, v[0] ?? ""])));
      }
      toast.error(err.message);
    },
  });

  const approve = useMutation({
    mutationFn: () => api("/results/approve", { method: "POST", body: { orderTestIds: [test.orderTestId] } }),
    onSuccess: async () => {
      toast.success(`${test.code} approved`);
      await afterChange();
    },
    onError: (err) => toast.error(err.message),
  });

  // Approve straight from the sheet: saves what's typed, submits it, then approves.
  const approveNow = useMutation({
    mutationFn: async () => {
      let current = test.status;
      if (dirty || current !== "SUBMITTED") {
        await save.mutateAsync(true);
        current = "SUBMITTED";
      }
      await api("/results/approve", { method: "POST", body: { orderTestIds: [test.orderTestId] } });
    },
    onSuccess: async () => {
      toast.success(`${test.code} approved`);
      await afterChange();
    },
    onError: (err) => toast.error(err.message),
  });
  const busy = approveNow.isPending || approve.isPending;

  const sendBackOrReopen = useMutation({
    mutationFn: ({ kind, note }: { kind: "send-back" | "reopen"; note: string }) =>
      api<{ sheet: ResultSheet }>(`/results/tests/${test.orderTestId}/${kind}`, {
        method: "POST",
        body: kind === "send-back" ? { note } : { reason: note },
      }),
    onSuccess: async (r, v) => {
      toast.success(v.kind === "send-back" ? `${test.code} sent back` : `${test.code} reopened`);
      setDialog(null);
      await afterChange(r.sheet);
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Card className={cn(test.status === "APPROVED" && "border-emerald-600/30")}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {test.name}
          <TestStatusBadge status={test.status} />
        </CardTitle>
        <CardDescription>
          {test.department}
          {test.sampleBarcode && ` · tube ${test.sampleBarcode}`}
          {test.enteredBy && ` · entered by ${test.enteredBy}`}
          {test.approvedBy && ` · approved by ${test.approvedBy}`}
        </CardDescription>
        {editable && (
          <CardAction className="flex items-center gap-2">
            {dirty && <span className="hidden text-sm text-muted-foreground sm:inline">Unsaved changes</span>}
            <Button variant="outline" size="sm" disabled={save.isPending || !dirty} onClick={() => save.mutate(false)}>
              {save.isPending && save.variables === false && <Spinner />}
              Save
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {test.status === "AWAITING_SAMPLE" && (
          <p className="text-sm text-muted-foreground">Waiting for the sample to be received in the lab.</p>
        )}
        {test.sendBackNote && test.status !== "APPROVED" && (
          <Alert>
            <MessageSquareWarningIcon />
            <AlertTitle>{test.sendBackNote.startsWith("Reopened:") ? "Reopened for correction" : "Sent back by the pathologist"}</AlertTitle>
            <AlertDescription>{test.sendBackNote.replace(/^Reopened:\s*/, "")}</AlertDescription>
          </Alert>
        )}

        {test.outsourceLab && (
          <OutsourcePanel test={test} editable={editable} mode={mode} onMode={setMode} onSheet={(s) => afterChange(s)} />
        )}

        {test.culture && cultureConfig && cultureState && !uploadMode && (
          <CultureEntry
            config={cultureConfig}
            state={cultureState}
            onChange={setCultureState}
            editable={editable}
            error={fieldErrors.culture}
            idPrefix={`cul-${test.orderTestId}`}
          />
        )}

        <div className={cn("overflow-x-auto", (uploadMode || !!test.culture) && "hidden")}>
          {/* Phones show two columns; unit, range, flag and previous value sit under the name and the input. */}
          <table className="w-full text-sm sm:min-w-[40rem]">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b [&>th]:py-2 [&>th]:pr-3 [&>th]:font-medium">
                <th>Parameter</th>
                <th className="w-32 sm:w-40">Result</th>
                <th className="hidden w-24 sm:table-cell">Unit</th>
                <th className="hidden w-36 sm:table-cell">Reference</th>
                <th className="hidden w-32 sm:table-cell">Flag</th>
                <th className="hidden w-32 sm:table-cell">Previous</th>
              </tr>
            </thead>
            <tbody>
              {test.parameters.map((p) => {
                const value = shown[p.parameterId] ?? "";
                const flag = flagFor(p.resultType, value || null, p.range);
                const error = fieldErrors[p.parameterId];
                return (
                  <tr
                    key={p.parameterId}
                    className={cn("border-b last:border-0 [&>td]:py-1.5 [&>td]:pr-3", isCritical(flag) && "bg-red-50 dark:bg-red-950/30")}
                  >
                    <td>
                      <div className={cn(flag && flag !== "NORMAL" && "font-semibold")}>{p.name}</div>
                      {p.source && value === (p.value ?? "") && (
                        <div className="inline-flex items-center gap-1 text-xs text-sky-700 dark:text-sky-400" title={`Sent by ${p.source}; check it before submitting`}>
                          <CpuIcon className="size-3" /> From {p.source}
                        </div>
                      )}
                      <div className="text-xs text-muted-foreground tabular-nums sm:hidden">
                        {[p.unit, p.range ? formatRange(p.range, p.decimals) : null].filter(Boolean).join(" · ")}
                        {p.previous && ` · was ${p.previous.value}`}
                      </div>
                      {p.formula && <div className="text-xs text-muted-foreground">Calculated: {p.formula}</div>}
                      {error && <div className="text-xs text-destructive">{error}</div>}
                    </td>
                    <td>
                      {p.formula ? (
                        <span className={cn("tabular-nums", flag && flag !== "NORMAL" && "font-semibold")}>{value || "—"}</span>
                      ) : p.resultType === "OPTIONS" ? (
                        <select
                          data-result-input
                          aria-label={p.name}
                          aria-invalid={!!error}
                          disabled={!editable}
                          className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm disabled:opacity-70 aria-invalid:border-destructive dark:bg-input/30"
                          value={value}
                          onChange={(e) => setValues((v) => ({ ...v, [p.parameterId]: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              focusNext(e.currentTarget);
                            }
                          }}
                        >
                          <option value="">—</option>
                          {p.options.map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <Input
                          data-result-input
                          aria-label={p.name}
                          aria-invalid={!!error}
                          disabled={!editable}
                          inputMode={p.resultType === "NUMERIC" ? "decimal" : "text"}
                          autoComplete="off"
                          className={cn("h-8 tabular-nums", flag && flag !== "NORMAL" && "font-semibold", isCritical(flag) && "border-red-500 text-red-700 dark:text-red-400")}
                          value={value}
                          onChange={(e) => setValues((v) => ({ ...v, [p.parameterId]: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              focusNext(e.currentTarget);
                            }
                          }}
                        />
                      )}
                      <div className="sm:hidden">
                        <FlagMark flag={flag} />
                      </div>
                    </td>
                    <td className="hidden text-muted-foreground sm:table-cell">{p.unit}</td>
                    <td className="hidden tabular-nums text-muted-foreground sm:table-cell">{p.range ? formatRange(p.range, p.decimals) : "—"}</td>
                    <td className="hidden sm:table-cell">
                      <FlagMark flag={flag} />
                    </td>
                    <td className="hidden text-xs text-muted-foreground sm:table-cell">
                      {p.previous && (
                        <span title={`On ${dateFmt.format(new Date(p.previous.date))}`}>
                          <span className={cn("tabular-nums", p.previous.flag && p.previous.flag !== "NORMAL" && "font-semibold")}>{p.previous.value}</span>{" "}
                          · {dateFmt.format(new Date(p.previous.date))}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {(editable || remarks) && (
          <div className="grid gap-1.5">
            <Label htmlFor={`remarks-${test.orderTestId}`}>Remarks on report (optional)</Label>
            <Textarea
              id={`remarks-${test.orderTestId}`}
              rows={2}
              disabled={!editable}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
            />
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2">
          {test.status === "SUBMITTED" && approver && (
            <Button variant="outline" onClick={() => setDialog("send-back")}>
              <RotateCcwIcon /> Send back
            </Button>
          )}
          {editable && !approver && (
            <Button disabled={save.isPending || (test.status === "SUBMITTED" && !dirty)} onClick={() => save.mutate(true)}>
              {save.isPending && save.variables === true ? <Spinner /> : <SendIcon />}
              {test.status === "SUBMITTED" ? "Resubmit" : "Submit for approval"}
            </Button>
          )}
          {approver && (
            <Button variant="outline" disabled={test.status !== "APPROVED"} onClick={() => setDialog("reopen")}>
              <RotateCcwIcon /> Unapprove
            </Button>
          )}
          {approver && (
            <Button
              disabled={busy || test.status === "APPROVED" || !editable}
              onClick={() => approveNow.mutate()}
            >
              {busy ? <Spinner /> : <CheckIcon />} Approve
            </Button>
          )}
          {can("reports:read") && (
            <Button variant="outline" disabled={test.status !== "APPROVED"} onClick={() => onPrint?.()}>
              <PrinterIcon /> Print
            </Button>
          )}
        </div>
      </CardContent>

      <NoteDialog
        open={dialog !== null}
        onOpenChange={(o) => !o && setDialog(null)}
        title={dialog === "reopen" ? `Reopen ${test.code}?` : `Send ${test.code} back?`}
        description={
          dialog === "reopen"
            ? "The results go back to the technician for correction and must be approved again. The reason is kept in the audit log."
            : "The technician sees your note and resubmits."
        }
        label={dialog === "reopen" ? "Reason" : "What needs checking"}
        confirm={dialog === "reopen" ? "Reopen" : "Send back"}
        pending={sendBackOrReopen.isPending}
        onConfirm={(note) => dialog && sendBackOrReopen.mutate({ kind: dialog, note })}
      />
    </Card>
  );
}
