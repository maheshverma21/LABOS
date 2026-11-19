"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeftIcon, CheckIcon, ChevronsUpDownIcon, LinkIcon, PencilIcon, PlusIcon, RotateCwIcon, Trash2Icon } from "lucide-react";
import {
  INSTRUMENT_MESSAGE_LABEL,
  INSTRUMENT_MESSAGE_STATUSES,
  type InstrumentMessageItem,
  type InstrumentMessageStatus,
  type MappableParameter,
} from "@lms/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { PageHeader } from "@/components/app-shell/page-header";
import { InstrumentDialog, OnlineDot } from "@/components/analyzers/instrument-dialog";
import { api } from "@/lib/api";
import { APP_NAME } from "@/lib/brand";
import { instrumentKeys, useInstrumentMappings, useInstrumentMessages, useInstruments, useMappableParameters, type MappingData } from "@/lib/instruments";
import { formatDateTime } from "@/lib/orders";
import { cn } from "@/lib/utils";

const STATUS_STYLE: Record<InstrumentMessageStatus, string> = {
  APPLIED: "border-emerald-600/30 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  PARTIAL: "border-sky-600/30 bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300",
  NOT_APPLIED: "border-amber-600/30 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  ERROR: "border-red-600/30 bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300",
};
const ALL = "all";

const paramLabel = (p: MappableParameter) => `${p.testName} · ${p.name}`;

function ParameterPicker({ value, onChange, parameters }: { value: string; onChange: (id: string) => void; parameters: MappableParameter[] }) {
  const [open, setOpen] = useState(false);
  const current = parameters.find((p) => p.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal">
          <span className={cn("truncate", !current && "text-muted-foreground")}>{current ? paramLabel(current) : "Pick a test parameter"}</span>
          <ChevronsUpDownIcon className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search test or parameter…" />
          <CommandList>
            <CommandEmpty>Nothing found.</CommandEmpty>
            <CommandGroup>
              {parameters.map((p) => (
                <CommandItem
                  key={p.id}
                  value={`${p.testName} ${p.name} ${p.code} ${p.testCode}`}
                  onSelect={() => {
                    onChange(p.id);
                    setOpen(false);
                  }}
                >
                  <CheckIcon className={cn(p.id === value ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{paramLabel(p)}</span>
                  <span className="ml-auto font-mono text-xs text-muted-foreground">{p.code}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

type Row = { key: number; analyzerCode: string; parameterId: string; factor: string };
let nextKey = 1;
const toRows = (d: MappingData): Row[] =>
  d.mappings.map((m) => ({ key: nextKey++, analyzerCode: m.analyzerCode, parameterId: m.parameterId, factor: m.factor == null ? "" : String(m.factor) }));

function CodesEditor({ id, data, parameters }: { id: string; data: MappingData; parameters: MappableParameter[] }) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<Row[]>(() => toRows(data));
  const [dirty, setDirty] = useState(false);
  const update = (key: number, patch: Partial<Row>) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setDirty(true);
  };
  const add = (analyzerCode = "", parameterId = "") => {
    setRows((rs) => [...rs, { key: nextKey++, analyzerCode, parameterId, factor: "" }]);
    setDirty(true);
  };
  const listed = new Set(rows.map((r) => r.analyzerCode.trim().toUpperCase()));
  const waiting = data.unmapped.filter((c) => !listed.has(c.toUpperCase()));
  const suggestion = (code: string) => data.suggestions.find((s) => s.analyzerCode === code);
  const byId = (pid: string) => parameters.find((p) => p.id === pid);

  const save = useMutation({
    mutationFn: () => {
      const incomplete = rows.find((r) => !r.analyzerCode.trim() || !r.parameterId);
      if (incomplete) throw new Error("Each row needs the analyzer's code and a test parameter");
      const bad = rows.find((r) => r.factor.trim() && !(Number(r.factor) > 0));
      if (bad) throw new Error(`The multiplier for ${bad.analyzerCode} must be a number above 0`);
      return api<MappingData>(`/instruments/${id}/mappings`, {
        method: "PUT",
        body: { mappings: rows.map((r) => ({ analyzerCode: r.analyzerCode.trim(), parameterId: r.parameterId, factor: r.factor.trim() ? Number(r.factor) : null })) },
      });
    },
    onSuccess: async (d) => {
      queryClient.setQueryData(instrumentKeys.mappings(id), d);
      await queryClient.invalidateQueries({ queryKey: instrumentKeys.list() });
      setRows(toRows(d));
      setDirty(false);
      toast.success("Codes saved. Use Retry on earlier results to fill them in now.");
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="grid gap-6">
      {waiting.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Codes waiting to be linked</CardTitle>
            <CardDescription>The analyzer sent these, but LabOS doesn&apos;t know which test they belong to yet.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {data.suggestions.filter((s) => waiting.includes(s.analyzerCode)).length > 1 && (
              <Button
                size="sm"
                onClick={() => {
                  for (const c of waiting) {
                    const s = suggestion(c);
                    if (s) add(c, s.parameterId);
                  }
                }}
              >
                <LinkIcon /> Link all suggested
              </Button>
            )}
            {waiting.map((c) => {
              const s = suggestion(c);
              const p = s && byId(s.parameterId);
              return (
                <Button key={c} variant="outline" size="sm" onClick={() => add(c, s?.parameterId ?? "")}>
                  <span className="font-mono">{c}</span>
                  {p ? <span className="text-muted-foreground">→ {p.name}</span> : <PlusIcon />}
                </Button>
              );
            })}
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Linked codes</CardTitle>
          <CardDescription>
            Codes that already match a LabOS parameter code (e.g. RBC = RBC) work without a link. A multiplier converts units, e.g. 0.001 for /µL to 10³/µL.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {rows.length === 0 && <p className="text-sm text-muted-foreground">No linked codes yet.</p>}
          {rows.map((r) => (
            <div key={r.key} className="grid items-center gap-2 sm:grid-cols-[8rem_minmax(0,1fr)_7rem_auto]">
              <Input aria-label="Analyzer code" placeholder="Code, e.g. HGB" className="font-mono uppercase" value={r.analyzerCode} onChange={(e) => update(r.key, { analyzerCode: e.target.value })} />
              <ParameterPicker value={r.parameterId} onChange={(pid) => update(r.key, { parameterId: pid })} parameters={parameters} />
              <Input aria-label="Multiplier" placeholder="× (optional)" inputMode="decimal" value={r.factor} onChange={(e) => update(r.key, { factor: e.target.value })} />
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove ${r.analyzerCode || "row"}`}
                onClick={() => {
                  setRows((rs) => rs.filter((x) => x.key !== r.key));
                  setDirty(true);
                }}
              >
                <Trash2Icon />
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="outline" onClick={() => add()}>
              <PlusIcon /> Add a code
            </Button>
            <Button disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
              {save.isPending && <Spinner />}
              Save codes
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function MessageRow({ m }: { m: InstrumentMessageItem }) {
  const queryClient = useQueryClient();
  const retry = useMutation({
    mutationFn: () => api<{ message: InstrumentMessageItem | null }>(`/instruments/messages/${m.id}/retry`, { method: "POST" }),
    onSuccess: async ({ message }) => {
      await queryClient.invalidateQueries({ queryKey: instrumentKeys.all });
      toast.success(message ? `Tried again: ${message.summary}` : "Tried again");
    },
    onError: (err) => toast.error(err.message),
  });
  return (
    <li className="grid gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Badge variant="outline" className={STATUS_STYLE[m.status]}>
          {INSTRUMENT_MESSAGE_LABEL[m.status]}
        </Badge>
        <span className="font-mono text-sm">{m.sampleId ?? "—"}</span>
        {m.orderId && (
          <Link href={`/results/${m.orderId}`} className="text-sm text-muted-foreground hover:underline">
            {m.orderNo}
          </Link>
        )}
        <span className="text-xs text-muted-foreground">{formatDateTime(m.createdAt)}</span>
        {m.status !== "APPLIED" && (
          <Button variant="ghost" size="sm" className="ml-auto" disabled={retry.isPending} onClick={() => retry.mutate()}>
            {retry.isPending ? <Spinner /> : <RotateCwIcon />} Retry
          </Button>
        )}
      </div>
      <div className="text-sm">{m.summary}</div>
      <details className="text-sm">
        <summary className="cursor-pointer text-xs text-muted-foreground">Values and raw message</summary>
        {m.detail.length > 0 && (
          <div className="mt-2 overflow-x-auto rounded-lg border">
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground">
                <tr className="border-b [&>th]:px-2 [&>th]:py-1.5 [&>th]:font-medium">
                  <th>Code</th>
                  <th>Value</th>
                  <th>Went to</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {m.detail.map((d, i) => (
                  <tr key={i} className="border-b last:border-0 [&>td]:px-2 [&>td]:py-1">
                    <td className="font-mono">{d.code}</td>
                    <td className="tabular-nums">
                      {d.value} {d.unit}
                    </td>
                    <td>{d.target ?? "—"}</td>
                    <td className={d.applied ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}>{d.applied ? "Filled in" : d.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <pre className="mt-2 max-h-56 overflow-auto rounded-lg bg-muted p-2 font-mono text-[11px] leading-snug whitespace-pre-wrap">{m.raw.replace(/\r/g, "\n")}</pre>
      </details>
    </li>
  );
}

function MessagesLog({ id }: { id: string }) {
  const [status, setStatus] = useState<InstrumentMessageStatus | typeof ALL>(ALL);
  const { data: messages, isPending } = useInstrumentMessages(id, status === ALL ? "" : status);
  return (
    <Card className="gap-0 py-0">
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <div className="text-sm text-muted-foreground">Updates every 10 seconds. The last 100 messages.</div>
        <Select value={status} onValueChange={(v) => setStatus(v as InstrumentMessageStatus | typeof ALL)}>
          <SelectTrigger className="ml-auto w-44" aria-label="Show">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All messages</SelectItem>
            {INSTRUMENT_MESSAGE_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {INSTRUMENT_MESSAGE_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {isPending ? (
        <Skeleton className="m-4 h-16" />
      ) : !messages?.length ? (
        <p className="p-6 text-center text-sm text-muted-foreground">Nothing received yet. Run a sample on the analyzer, or check the interface program&apos;s window.</p>
      ) : (
        <ul className="divide-y">
          {messages.map((m) => (
            <MessageRow key={m.id} m={m} />
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function AnalyzerPage() {
  const { id } = useParams<{ id: string }>();
  const { data: instruments, isPending } = useInstruments();
  const instrument = instruments?.find((i) => i.id === id);
  const mappings = useInstrumentMappings(id);
  const parameters = useMappableParameters();
  const [tab, setTab] = useState<"log" | "codes">("log");
  const [editing, setEditing] = useState(false);

  return (
    <>
      <title>{`${instrument?.name ?? "Analyzer"} · ${APP_NAME}`}</title>
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-2">
          <Link href="/settings/analyzers">
            <ArrowLeftIcon /> Analyzers
          </Link>
        </Button>
        <PageHeader
          title={instrument?.name ?? "Analyzer"}
          description={instrument ? [instrument.model, instrument.protocol, instrument.connection === "LISTEN" ? `port ${instrument.port}` : `${instrument.host}:${instrument.port}`].filter(Boolean).join(" · ") : undefined}
          actions={
            instrument && (
              <Button variant="outline" onClick={() => setEditing(true)}>
                <PencilIcon /> Edit
              </Button>
            )
          }
        />
        {instrument && (
          <div className="mt-2">
            <OnlineDot instrument={instrument} />
          </div>
        )}
      </div>
      {isPending ? (
        <Skeleton className="h-64 max-w-4xl" />
      ) : !instrument ? (
        <p className="text-sm text-muted-foreground">This analyzer no longer exists.</p>
      ) : (
        <div className="grid max-w-4xl gap-4">
          <div role="tablist" className="flex w-fit rounded-lg border p-0.5">
            {(
              [
                ["log", "Results log"],
                ["codes", `Test codes${mappings.data?.unmapped.length ? ` (${mappings.data.unmapped.length} to link)` : ""}`],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                role="tab"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                className={cn("rounded-md px-3 py-1.5 text-sm", tab === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === "log" ? (
            <MessagesLog id={id} />
          ) : mappings.data && parameters.data ? (
            <CodesEditor key={JSON.stringify(mappings.data)} id={id} data={mappings.data} parameters={parameters.data} />
          ) : (
            <Skeleton className="h-48" />
          )}
        </div>
      )}
      {editing && instrument && <InstrumentDialog instrument={instrument} onClose={() => setEditing(false)} />}
    </>
  );
}
