"use client";

import { DateRangeInput } from "@/components/filters/date-range-input";
import { useDeferredValue, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TriangleAlertIcon } from "lucide-react";
import { patientDisplayName, todayIST } from "@lms/shared";
import type { WorklistOrder } from "@lms/shared";
import { Badge } from "@/components/ui/badge";
import { CheckIcon } from "lucide-react";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/app-shell/page-header";
import { ActiveFilterChips, ListFilterButton, useListFilters } from "@/components/filters/list-filters";
import { TestStatusBadge } from "@/components/results/test-status-badge";
import { BarcodeEditDialog } from "@/components/reports/barcode-edit-dialog";
import { PreviewDialog, type Preview } from "@/components/reports/preview-dialog";
import { Actions, BarcodePrint } from "@/components/reports/row-controls";
import { useAuth } from "@/providers/auth-provider";
import { APP_NAME } from "@/lib/brand";
import { useDepartments } from "@/lib/catalog";
import { formatDateTime, formatDay, formatTime } from "@/lib/orders";
import { ageSex } from "@/lib/patients";
import { useWorklist, type WorklistTab } from "@/lib/results";
import { cn } from "@/lib/utils";

const ALL = "all";

/** Each test's code coloured by its status; critical values stand out in red. */
function TestBadges({ tests }: { tests: WorklistOrder["tests"] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {tests.map((t) =>
        t.critical ? (
          <Badge key={t.orderTestId} variant="destructive" title={`${t.name}: critical value`}>
            <TriangleAlertIcon /> {t.code}
          </Badge>
        ) : (
          <TestStatusBadge key={t.orderTestId} status={t.status} className="font-mono">
            {t.code}
          </TestStatusBadge>
        ),
      )}
    </div>
  );
}

/** Report readiness: all tests approved, or how many are. */
function ReadyBadge({ o }: { o: WorklistOrder }) {
  const done = o.totalTests > 0 && o.approvedTests >= o.totalTests;
  return (
    <div>
      <Badge
        variant="outline"
        className={
          done
            ? "border-emerald-600/25 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
            : "border-amber-600/25 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
        }
      >
        {done ? <CheckIcon /> : null}
        {done ? "Ready" : "Pending"}
      </Badge>
      {!done && (
        <div className="mt-1 text-xs text-muted-foreground tabular-nums">
          {o.approvedTests} of {o.totalTests} ready
        </div>
      )}
    </div>
  );
}

export default function ResultsPage() {
  const { can } = useAuth();
  const router = useRouter();
  // Pathologists start on what's waiting for them.
  const [tab, setTab] = useState<WorklistTab>(can("results:approve") && !can("users:write") ? "approve" : "enter");
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState(ALL);
  const [date, setDate] = useState(todayIST());
  const [dateTo, setDateTo] = useState(todayIST());
  const [filters, setFilters] = useListFilters("results");
  const [editing, setEditing] = useState<WorklistOrder | null>(null);
  const [preview, setPreview] = useState<{ r: WorklistOrder; p: Preview } | null>(null);
  const q = useDeferredValue(search.trim());
  const departments = useDepartments();
  const { data, isPending } = useWorklist(tab, q, department === ALL ? "" : department, date, dateTo, filters.values);

  const tabs: { key: WorklistTab; label: string }[] = [
    { key: "enter", label: "To enter" },
    { key: "approve", label: "Awaiting approval" },
    { key: "approved", label: "Approved" },
  ];

  return (
    <>
      <title>{`Results · ${APP_NAME}`}</title>
      <PageHeader title="Results" description="Enter, check and approve results. Oldest orders first." />

      <div className="flex flex-wrap items-center gap-3">
        <div role="tablist" className="flex rounded-lg border p-0.5">
          {tabs.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm",
                tab === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setTab(t.key)}
            >
              {t.label}
              {tab === t.key && data ? ` (${data.length})` : ""}
            </button>
          ))}
        </div>
        <InputGroup className="w-full sm:w-64">
          <InputGroupInput placeholder="Lab no., patient or ID" aria-label="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
        </InputGroup>
        <Select value={department} onValueChange={setDepartment}>
          <SelectTrigger className="w-48" aria-label="Department">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All departments</SelectItem>
            {departments.data?.map((d) => (
              <SelectItem key={d.id} value={d.name}>
                {d.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {tab === "approved" && (
          <DateRangeInput from={date} to={dateTo} onChange={(f, t) => { setDate(f); setDateTo(t); }} />
        )}
        <div className="ml-auto">
          <ListFilterButton state={filters} onChange={setFilters} />
        </div>
      </div>
      <ActiveFilterChips state={filters} onChange={setFilters} />

      {/* Phones: one card per order; tap to open its results. */}
      <div className="grid gap-3 md:hidden">
        {isPending && <Skeleton className="h-24 w-full" />}
        {data?.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {tab === "enter" ? "Nothing to enter. Tests appear here once their sample is received." : tab === "approve" ? "Nothing waiting for approval." : "Nothing approved on this date."}
          </p>
        )}
        {data?.map((o) => (
          <Link key={o.orderId} href={`/results/${o.orderId}`} className="grid gap-2 rounded-lg border bg-card p-3 transition-colors hover:bg-accent/40">
            <div className="min-w-0">
              <div className="truncate font-medium">{patientDisplayName(o.patient)}</div>
              <div className="text-xs text-muted-foreground">
                {o.patient.uhid} · {ageSex(o.patient)}
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              <span className="font-mono font-medium text-foreground">{o.orderNo}</span> · {formatDateTime(o.createdAt)}
            </div>
            {(o.doctor || o.account) && (
              <div className="text-xs text-muted-foreground">{[o.doctor && `Ref: ${o.doctor}`, o.account].filter(Boolean).join(" · ")}</div>
            )}
            <TestBadges tests={o.tests} />
          </Link>
        ))}
      </div>

      <div className="hidden overflow-x-auto rounded-lg border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Bill date</TableHead>
              <TableHead className="w-32">Lab ID</TableHead>
              <TableHead>Patient</TableHead>
              <TableHead>Referral</TableHead>
              <TableHead>Tests</TableHead>
              <TableHead className="w-32">Status</TableHead>
              <TableHead>Barcode</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending && (
              <TableRow>
                <TableCell colSpan={8}>
                  <Skeleton className="h-5 w-full" />
                </TableCell>
              </TableRow>
            )}
            {data?.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                  {tab === "enter" ? "Nothing to enter. Tests appear here once their sample is received." : tab === "approve" ? "Nothing waiting for approval." : "Nothing approved on this date."}
                </TableCell>
              </TableRow>
            )}
            {data?.map((o) => (
              <TableRow key={o.orderId} className="cursor-pointer" onClick={() => router.push(`/results/${o.orderId}`)}>
                <TableCell className="whitespace-nowrap">
                  <div className="text-sm">{formatDay(o.createdAt)}</div>
                  <div className="text-xs text-muted-foreground">{formatTime(o.createdAt)}</div>
                </TableCell>
                <TableCell>
                  <Link href={`/results/${o.orderId}`} className="font-mono text-xs font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                    {o.orderNo}
                  </Link>
                </TableCell>
                <TableCell>
                  <div className="font-medium">{patientDisplayName(o.patient)}</div>
                  <div className="text-xs text-muted-foreground">{ageSex(o.patient)}</div>
                </TableCell>
                <TableCell className="text-sm">
                  {[o.doctor, o.account].filter(Boolean).join(" · ") || <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="max-w-80 whitespace-normal">
                  <TestBadges tests={o.tests} />
                </TableCell>
                <TableCell>
                  <ReadyBadge o={o} />
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <BarcodePrint r={o} onPreview={(p) => setPreview({ r: o, p })} onEdit={() => setEditing(o)} />
                </TableCell>
                <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                  <Actions r={o} onPreview={(p) => setPreview({ r: o, p })} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {preview && (
        <PreviewDialog
          key={`${preview.r.orderId}-${JSON.stringify(preview.p)}`}
          r={preview.r}
          preview={preview.p}
          onClose={() => setPreview(null)}
        />
      )}
      {editing && (
        <BarcodeEditDialog
          key={editing.orderId}
          orderId={editing.orderId}
          orderNo={editing.orderNo}
          onClose={() => setEditing(null)}
          onPrint={(ids) => {
            setPreview({ r: editing, p: { kind: "barcode", ids } });
            setEditing(null);
          }}
        />
      )}
    </>
  );
}
