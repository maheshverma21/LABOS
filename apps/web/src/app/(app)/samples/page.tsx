"use client";

import { DateRangeInput } from "@/components/filters/date-range-input";
import { useDeferredValue, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { BanIcon, PrinterIcon, ScanBarcodeIcon, TestTubeDiagonalIcon } from "lucide-react";
import {
  patientDisplayName,
  sampleTypeLabel,
  todayIST,
  type SampleItem,
  type SampleStatus,
} from "@lms/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/app-shell/page-header";
import { ActiveFilterChips, ListFilterButton, useListFilters } from "@/components/filters/list-filters";
import { RejectSampleDialog } from "@/components/samples/reject-dialog";
import { SampleStatusBadge } from "@/components/samples/sample-status-badge";
import { useSampleActions } from "@/components/samples/use-sample-actions";
import { useAuth } from "@/providers/auth-provider";
import { api, ApiError } from "@/lib/api";
import { APP_NAME } from "@/lib/brand";
import { formatTime } from "@/lib/orders";
import { ageSex } from "@/lib/patients";
import { useSamples } from "@/lib/samples";
import { cn } from "@/lib/utils";

const TABS: { status: SampleStatus; label: string }[] = [
  { status: "PENDING", label: "To collect" },
  { status: "COLLECTED", label: "Collected" },
  { status: "RECEIVED", label: "Received" },
  { status: "REJECTED", label: "Rejected" },
];

const RECEIVE_ON_SCAN_KEY = "lms.receiveOnScan";

function readReceiveOnScan(fallback: boolean) {
  try {
    const v = window.localStorage.getItem(RECEIVE_ON_SCAN_KEY);
    return v == null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

/** Scanner input: barcode scanners type the code and press Enter. */
function ScanBox({ onLookup }: { onLookup: (s: SampleItem | null) => void }) {
  const { can } = useAuth();
  const { receive } = useSampleActions();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  // Lab staff mostly scan tubes arriving from centres: receive straight away.
  const [receiveOnScan, setReceiveOnScan] = useState(() => readReceiveOnScan(can("results:write")));
  const input = useRef<HTMLInputElement>(null);

  const submit = async () => {
    const code = value.replace(/\s/g, "");
    if (!code) return;
    setValue("");
    if (receiveOnScan && can("samples:write")) {
      receive.mutate({ barcodes: [code] });
    } else {
      setBusy(true);
      try {
        const { sample } = await api<{ sample: SampleItem }>(`/samples/barcode/${encodeURIComponent(code)}`);
        onLookup(sample);
      } catch (err) {
        onLookup(null);
        toast.error(err instanceof ApiError ? err.message : "Lookup failed");
      } finally {
        setBusy(false);
      }
    }
    input.current?.focus();
  };

  return (
    <Card className="py-4">
      <CardContent className="flex flex-wrap items-center gap-3 px-4">
        <InputGroup className="w-full sm:max-w-sm">
          <InputGroupAddon>
            <ScanBarcodeIcon />
          </InputGroupAddon>
          <InputGroupInput
            ref={input}
            autoFocus
            inputMode="numeric"
            placeholder="Scan or type a barcode, then Enter"
            aria-label="Scan barcode"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submit();
              }
            }}
          />
          {(busy || receive.isPending) && (
            <InputGroupAddon align="inline-end">
              <Spinner />
            </InputGroupAddon>
          )}
        </InputGroup>
        {can("samples:write") && (
          <div className="flex items-center gap-2">
            <Checkbox
              id="receive-on-scan"
              checked={receiveOnScan}
              onCheckedChange={(v) => {
                setReceiveOnScan(v === true);
                try {
                  window.localStorage.setItem(RECEIVE_ON_SCAN_KEY, v === true ? "1" : "0");
                } catch {
                  // remembered for this visit only
                }
              }}
            />
            <Label htmlFor="receive-on-scan" className="font-normal">
              Receive in lab on scan
            </Label>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ScannedSample({ sample, onReject }: { sample: SampleItem; onReject: (s: SampleItem) => void }) {
  const { can } = useAuth();
  const { collect, receive } = useSampleActions();
  return (
    <Card className="py-4">
      <CardContent className="flex flex-wrap items-center gap-4 px-4">
        <TestTubeDiagonalIcon className="size-5 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono font-medium">{sample.barcode}</span>
            <SampleStatusBadge status={sample.status} />
            <span className="text-sm text-muted-foreground">{sample.container ?? sampleTypeLabel(sample.sampleType)}</span>
          </div>
          <div className="text-sm">
            <Link href={`/orders/${sample.order.id}`} className="font-medium hover:underline">
              {patientDisplayName(sample.order.patient)}
            </Link>{" "}
            <span className="text-muted-foreground">
              · {ageSex(sample.order.patient)} · {sample.order.orderNo} · {sample.tests.map((t) => t.code).join(", ")}
            </span>
          </div>
          {sample.rejectReason && <div className="text-sm text-destructive">Rejected: {sample.rejectReason}</div>}
        </div>
        {can("samples:write") && (
          <div className="flex gap-2">
            {sample.status === "PENDING" && (
              <Button variant="outline" disabled={collect.isPending} onClick={() => collect.mutate([sample.id])}>
                Mark collected
              </Button>
            )}
            {(sample.status === "PENDING" || sample.status === "COLLECTED") && (
              <Button disabled={receive.isPending} onClick={() => receive.mutate({ sampleIds: [sample.id] })}>
                Receive in lab
              </Button>
            )}
            {(sample.status === "COLLECTED" || sample.status === "RECEIVED") && (
              <Button variant="outline" onClick={() => onReject(sample)}>
                <BanIcon /> Reject
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function SamplesPage() {
  const { can, user } = useAuth();
  const [status, setStatus] = useState<SampleStatus>("PENDING");
  const [date, setDate] = useState(todayIST());
  const [dateTo, setDateTo] = useState(todayIST());
  const [search, setSearch] = useState("");
  const q = useDeferredValue(search.trim());
  // Collection centres see their own tubes; the lab sees everything coming in.
  const [scope, setScope] = useState<"branch" | "all">("all");
  const [filters, setFilters] = useListFilters("samples");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scanned, setScanned] = useState<SampleItem | null>(null);
  const [rejecting, setRejecting] = useState<SampleItem | null>(null);
  const { collect, receive } = useSampleActions();
  const { data, isPending } = useSamples(status, date, dateTo, q, scope, filters.values);
  const canWrite = can("samples:write");
  const dated = status === "RECEIVED" || status === "REJECTED";

  const visibleIds = data?.samples.map((s) => s.id) ?? [];
  const chosen = [...selected].filter((id) => visibleIds.includes(id));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const timeOf = (s: SampleItem) =>
    status === "PENDING" ? s.order.createdAt : status === "COLLECTED" ? s.collectedAt : status === "RECEIVED" ? s.receivedAt : s.rejectedAt;

  const selectable = canWrite && (status === "PENDING" || status === "COLLECTED");
  const rowActions = (s: SampleItem) => (
    <>
      {status === "PENDING" && (
        <Button variant="ghost" size="sm" asChild>
          <a href={`/print/labels/${s.order.id}`} target="_blank" rel="noreferrer">
            <PrinterIcon /> Labels
          </a>
        </Button>
      )}
      {canWrite && status === "COLLECTED" && (
        <Button size="sm" disabled={receive.isPending} onClick={() => receive.mutate({ sampleIds: [s.id] })}>
          Receive
        </Button>
      )}
      {canWrite && status === "RECEIVED" && (
        <Button variant="ghost" size="sm" onClick={() => setRejecting(s)}>
          <BanIcon /> Reject
        </Button>
      )}
    </>
  );

  return (
    <>
      <title>{`Accession · ${APP_NAME}`}</title>
      <PageHeader title="Accession" description="Collect, receive and track every tube." />

      <ScanBox onLookup={setScanned} />
      {scanned && <ScannedSample key={`${scanned.id}-${scanned.status}`} sample={scanned} onReject={setRejecting} />}

      <div className="flex flex-wrap items-center gap-3">
        <div role="tablist" className="flex rounded-lg border p-0.5">
          {TABS.map((t) => (
            <button
              key={t.status}
              role="tab"
              aria-selected={status === t.status}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm",
                status === t.status ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => {
                setStatus(t.status);
                setSelected(new Set());
              }}
            >
              {t.label}
              {status === t.status && data ? ` (${data.total})` : ""}
            </button>
          ))}
        </div>
        <InputGroup className="w-full sm:w-64">
          <InputGroupInput placeholder="Barcode, lab no. or patient" aria-label="Filter samples" value={search} onChange={(e) => setSearch(e.target.value)} />
        </InputGroup>
        {dated ? (
          <DateRangeInput from={date} to={dateTo} onChange={(f, t) => { setDate(f); setDateTo(t); }} />
        ) : (
          (user?.branches.length ?? 0) > 1 && (
            <div className="flex items-center gap-2">
              <Checkbox id="my-branch" checked={scope === "branch"} onCheckedChange={(v) => setScope(v === true ? "branch" : "all")} />
              <Label htmlFor="my-branch" className="font-normal">
                This branch only
              </Label>
            </div>
          )
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          {canWrite && chosen.length > 0 && (
          <>
            {status === "PENDING" && (
              <Button variant="outline" disabled={collect.isPending} onClick={() => collect.mutate(chosen, { onSuccess: () => setSelected(new Set()) })}>
                Mark {chosen.length} collected
              </Button>
            )}
            {(status === "PENDING" || status === "COLLECTED") && (
              <Button disabled={receive.isPending} onClick={() => receive.mutate({ sampleIds: chosen }, { onSuccess: () => setSelected(new Set()) })}>
                Receive {chosen.length} in lab
              </Button>
            )}
          </>
          )}
          <ListFilterButton state={filters} onChange={setFilters} />
        </div>
      </div>
      <ActiveFilterChips state={filters} onChange={setFilters} />

      {/* Phones: one card per tube, with the same selection and actions. */}
      <div className="grid gap-3 md:hidden">
        {selectable && visibleIds.length > 0 && (
          <label className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
            <Checkbox
              checked={chosen.length === visibleIds.length}
              onCheckedChange={(v) => setSelected(v === true ? new Set(visibleIds) : new Set())}
            />
            Select all ({visibleIds.length})
          </label>
        )}
        {isPending && <Skeleton className="h-24 w-full" />}
        {data?.samples.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">Nothing here{dated ? " for this date" : ""}.</p>}
        {data?.samples.map((s) => {
          const t = timeOf(s);
          return (
            <div key={s.id} className={cn("flex gap-3 rounded-lg border bg-card p-3", selected.has(s.id) && "border-primary bg-primary/5")}>
              {selectable && <Checkbox className="mt-1" aria-label={`Select ${s.barcode}`} checked={selected.has(s.id)} onCheckedChange={() => toggle(s.id)} />}
              <div className="grid min-w-0 flex-1 gap-1.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{patientDisplayName(s.order.patient)}</div>
                    <div className="text-xs text-muted-foreground">
                      {ageSex(s.order.patient)}
                      {s.order.branch && ` · ${s.order.branch.name}`}
                    </div>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{t ? formatTime(t) : ""}</span>
                </div>
                <div className="text-xs">
                  <span className="font-mono font-medium">{s.barcode}</span> ·{" "}
                  <Link href={`/orders/${s.order.id}`} className="text-muted-foreground hover:underline">
                    {s.order.orderNo}
                  </Link>
                </div>
                <div className="text-xs text-muted-foreground">
                  {s.container ?? sampleTypeLabel(s.sampleType)} · {s.tests.map((x) => x.code).join(", ")}
                </div>
                {s.rejectReason && <div className="text-xs text-destructive">{s.rejectReason}</div>}
                <div className="flex flex-wrap justify-end gap-1">{rowActions(s)}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="hidden overflow-x-auto rounded-lg border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              {canWrite && (status === "PENDING" || status === "COLLECTED") && (
                <TableHead className="w-10">
                  <Checkbox
                    aria-label="Select all"
                    checked={visibleIds.length > 0 && chosen.length === visibleIds.length}
                    onCheckedChange={(v) => setSelected(v === true ? new Set(visibleIds) : new Set())}
                  />
                </TableHead>
              )}
              <TableHead className="w-36">Barcode</TableHead>
              <TableHead>Patient</TableHead>
              <TableHead className="hidden md:table-cell">Tube</TableHead>
              <TableHead className="hidden lg:table-cell">Tests</TableHead>
              <TableHead className="w-20">Time</TableHead>
              <TableHead className="w-40 text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending && (
              <TableRow>
                <TableCell colSpan={7}>
                  <Skeleton className="h-5 w-full" />
                </TableCell>
              </TableRow>
            )}
            {data?.samples.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  Nothing here{dated ? " for this date" : ""}.
                </TableCell>
              </TableRow>
            )}
            {data?.samples.map((s) => {
              const t = timeOf(s);
              return (
                <TableRow key={s.id} data-state={selected.has(s.id) ? "selected" : undefined}>
                  {canWrite && (status === "PENDING" || status === "COLLECTED") && (
                    <TableCell>
                      <Checkbox aria-label={`Select ${s.barcode}`} checked={selected.has(s.id)} onCheckedChange={() => toggle(s.id)} />
                    </TableCell>
                  )}
                  <TableCell>
                    <div className="font-mono text-xs font-medium">{s.barcode}</div>
                    <Link href={`/orders/${s.order.id}`} className="text-xs text-muted-foreground hover:underline">
                      {s.order.orderNo}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{patientDisplayName(s.order.patient)}</div>
                    <div className="text-xs text-muted-foreground">
                      {ageSex(s.order.patient)}
                      {s.order.branch && ` · ${s.order.branch.name}`}
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-sm">{s.container ?? sampleTypeLabel(s.sampleType)}</TableCell>
                  <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                    {s.tests.map((x) => x.code).join(", ")}
                    {s.rejectReason && <div className="text-destructive">{s.rejectReason}</div>}
                  </TableCell>
                  <TableCell className="tabular-nums text-sm text-muted-foreground">{t ? formatTime(t) : ""}</TableCell>
                  <TableCell className="text-right">{rowActions(s)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <RejectSampleDialog
        sample={rejecting}
        onOpenChange={(open) => {
          if (!open) {
            setRejecting(null);
            setScanned(null);
          }
        }}
      />
    </>
  );
}
