"use client";

import { useDeferredValue, useState } from "react";
import Link from "next/link";
import { CheckIcon } from "lucide-react";
import { Actions, BarcodePrint } from "@/components/reports/row-controls";
import { PreviewDialog, type Preview } from "@/components/reports/preview-dialog";
import { ReportRowMenu } from "@/components/reports/row-menu";
import { BarcodeEditDialog } from "@/components/reports/barcode-edit-dialog";
import {
  formatINR,
  patientDisplayName,
  REPORT_STATE_LABEL,
  REPORT_STATES,
  todayIST,
  type ReportListItem,
  type ReportState,
} from "@lms/shared";
import { DateRangeInput } from "@/components/filters/date-range-input";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/app-shell/page-header";
import {
  ActiveFilterChips,
  ListFilterButton,
  useListFilters,
} from "@/components/filters/list-filters";
import {
  REPORT_STATE_STYLE,
  ReportStateBadge,
} from "@/components/reports/report-actions";
import { APP_NAME } from "@/lib/brand";
import { ageSex } from "@/lib/patients";
import { formatDateTime, formatDay, formatTime } from "@/lib/orders";
import { useReportList } from "@/lib/reports";
import { cn } from "@/lib/utils";

/** Each test of the order, green once approved and amber while still in progress. */
function TestChips({ tests }: { tests: ReportListItem["tests"] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {tests.map((t, i) => {
        const done = t.status === "APPROVED";
        return (
          <span
            key={`${t.name}-${i}`}
            title={done ? "Approved" : "In progress"}
            className={cn(
              "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs",
              done
                ? "border-emerald-600/25 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                : "border-amber-600/25 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
            )}
          >
            {done && <CheckIcon className="size-3" />}
            {t.name}
          </span>
        );
      })}
    </div>
  );
}

function Patient({
  r,
  showReferral = false,
}: {
  r: ReportListItem;
  showReferral?: boolean;
}) {
  return (
    <>
      <div className="font-medium">{patientDisplayName(r.patient)}</div>
      <div className="text-xs text-muted-foreground">
        {ageSex(r.patient)}
      </div>
      {showReferral && (r.doctor || r.account) && (
        <div className="text-xs text-muted-foreground">
          {[r.doctor && `Ref: ${r.doctor}`, r.account]
            .filter(Boolean)
            .join(" · ")}
        </div>
      )}
    </>
  );
}

export default function ReportsPage() {
  const [search, setSearch] = useState("");
  const [date, setDate] = useState(todayIST());
  const [dateTo, setDateTo] = useState(todayIST());
  const [state, setState] = useState<ReportState | "ALL">("ALL");
  const [filters, setFilters] = useListFilters("reports");
  const [editing, setEditing] = useState<ReportListItem | null>(null);
  const [preview, setPreview] = useState<{
    r: ReportListItem;
    p: Preview;
  } | null>(null);
  const q = useDeferredValue(search.trim());
  const { data, isPending } = useReportList(date, dateTo, q, filters.values);

  const counts = Object.fromEntries(
    REPORT_STATES.map((s) => [
      s,
      data?.filter((r) => r.state === s).length ?? 0,
    ]),
  ) as Record<ReportState, number>;
  const rows = state === "ALL" ? data : data?.filter((r) => r.state === state);
  const empty = rows?.length === 0;

  return (
    <>
      <title>{`Reports · ${APP_NAME}`}</title>
      <PageHeader
        title="Reports"
        description="Every order of the day and where its report stands. Print, send or hand over."
      />

      <div className="flex flex-wrap items-center gap-3">
        <InputGroup className="w-full sm:w-72">
          <InputGroupInput
            placeholder="Lab no., patient, ID or mobile"
            aria-label="Search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </InputGroup>
        <DateRangeInput
          from={date}
          to={dateTo}
          onChange={(f, t) => {
            setDate(f);
            setDateTo(t);
          }}
        />
        <div className="ml-auto">
          <ListFilterButton state={filters} onChange={setFilters} />
        </div>
      </div>
      <ActiveFilterChips state={filters} onChange={setFilters} />

      <div
        role="tablist"
        aria-label="Report status"
        className="flex flex-wrap gap-2"
      >
        {(["ALL", ...REPORT_STATES] as const).map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={state === s}
            onClick={() => setState(s)}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm transition-colors",
              state === s
                ? "border-primary bg-primary text-primary-foreground"
                : "hover:bg-accent",
            )}
          >
            {s !== "ALL" && (
              <span
                className={cn("size-2 rounded-full", REPORT_STATE_STYLE[s].dot)}
                aria-hidden
              />
            )}
            {s === "ALL" ? "All" : REPORT_STATE_LABEL[s]}
            <span
              className={cn(
                "tabular-nums",
                state === s
                  ? "text-primary-foreground/80"
                  : "text-muted-foreground",
              )}
            >
              {s === "ALL" ? (data?.length ?? 0) : counts[s]}
            </span>
          </button>
        ))}
      </div>

      {/* Phones: one card per order. */}
      <div className="grid gap-3 md:hidden">
        {isPending && <Skeleton className="h-28 w-full" />}
        {empty && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No orders in this period match.
          </p>
        )}
        {rows?.map((r) => (
          <div
            key={r.orderId}
            className={cn(
              "grid gap-2 rounded-lg border border-l-4 p-3",
              REPORT_STATE_STYLE[r.state].bar,
              REPORT_STATE_STYLE[r.state].row,
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <Patient r={r} showReferral />
              </div>
              <ReportStateBadge state={r.state} />
            </div>
            <div className="text-xs text-muted-foreground">
              <Link
                href={`/orders/${r.orderId}`}
                className="font-mono font-medium text-foreground hover:underline"
              >
                {r.orderNo}
              </Link>{" "}
              · {formatDateTime(r.createdAt)}
            </div>
            <TestChips tests={r.tests} />
            <div className="flex items-center justify-between text-xs">
              <BarcodePrint
                r={r}
                onPreview={(p) => setPreview({ r, p })}
                onEdit={() => setEditing(r)}
              />
              <span className="text-right tabular-nums">
                <span className="font-medium">{formatINR(r.netPaise)}</span>
                {r.paidPaise < r.netPaise && (
                  <span className="ml-2 font-medium text-red-600 dark:text-red-400">
                    Due {formatINR(r.netPaise - r.paidPaise)}
                  </span>
                )}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Actions r={r} onPreview={(p) => setPreview({ r, p })} />
              <ReportRowMenu r={r} />
            </div>
          </div>
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
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Due</TableHead>
              <TableHead className="w-32">Status</TableHead>
              <TableHead>Barcode</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending && (
              <TableRow>
                <TableCell colSpan={10}>
                  <Skeleton className="h-5 w-full" />
                </TableCell>
              </TableRow>
            )}
            {empty && (
              <TableRow>
                <TableCell
                  colSpan={10}
                  className="py-10 text-center text-muted-foreground"
                >
                  No orders in this period match.
                </TableCell>
              </TableRow>
            )}
            {rows?.map((r) => (
              <TableRow
                key={r.orderId}
                className={cn(
                  "border-l-4",
                  REPORT_STATE_STYLE[r.state].bar,
                  REPORT_STATE_STYLE[r.state].row,
                )}
              >
                <TableCell className="whitespace-nowrap">
                  <div className="text-sm">{formatDay(r.createdAt)}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatTime(r.createdAt)}
                  </div>
                </TableCell>
                <TableCell>
                  <Link
                    href={`/orders/${r.orderId}`}
                    className="font-mono text-xs font-medium hover:underline"
                  >
                    {r.orderNo}
                  </Link>
                </TableCell>
                <TableCell>
                  <Patient r={r} />
                </TableCell>
                <TableCell className="text-sm">
                  {[r.doctor, r.account].filter(Boolean).join(" · ") || (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="max-w-80 whitespace-normal">
                  <TestChips tests={r.tests} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <div className="font-medium">{formatINR(r.netPaise)}</div>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.paidPaise < r.netPaise ? (
                    <span className="font-medium text-red-600 dark:text-red-400">
                      {formatINR(r.netPaise - r.paidPaise)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <ReportStateBadge state={r.state} />
                  {r.state === "PENDING" && (
                    <div className="mt-1 text-xs text-muted-foreground tabular-nums">
                      {r.approvedTests} of {r.totalTests} ready
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <BarcodePrint
                    r={r}
                    onPreview={(p) => setPreview({ r, p })}
                    onEdit={() => setEditing(r)}
                  />
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <Actions r={r} onPreview={(p) => setPreview({ r, p })} />
                    <ReportRowMenu r={r} />
                  </div>
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
