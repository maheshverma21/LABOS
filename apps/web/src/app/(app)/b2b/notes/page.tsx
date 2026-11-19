"use client";

import { useState } from "react";
import { DownloadIcon, PlusIcon } from "lucide-react";
import { paiseToRupees } from "@lms/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DateRangeInput } from "@/components/filters/date-range-input";
import { LabPicker, formatRupees } from "@/components/b2b/lab-picker";
import { NoteDialog } from "@/components/b2b/note-dialog";
import { useDateRange } from "@/components/b2b/use-range";
import { useAuth } from "@/providers/auth-provider";
import { fmtStamp, useNotes } from "@/lib/accounts";
import { downloadCsv } from "@/lib/finance";

export default function NotesPage() {
  const { can } = useAuth();
  const range = useDateRange(89);
  const [labId, setLabId] = useState("");
  const [adding, setAdding] = useState(false);
  const { data, isPending } = useNotes(range, labId);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <DateRangeInput from={range.from} to={range.to} onChange={range.set} />
        <LabPicker value={labId} onChange={setLabId} allLabel="All B2B labs" />
        <div className="ml-auto flex gap-2">
          <Button
            variant="outline"
            disabled={!data?.length}
            onClick={() => downloadCsv(`credit-debit-notes_${range.from}_to_${range.to}.csv`, ["Note No", "Date", "B2B Lab", "Type", "Amount", "Reason"], (data ?? []).map((n) => [n.noteNo, n.createdAt, n.account.name, n.kind === "CREDIT" ? "Credit" : "Debit", paiseToRupees(n.amountPaise), n.reason]))}
          >
            <DownloadIcon /> Export
          </Button>
          {can("accounts:write") && (
            <Button onClick={() => setAdding(true)}>
              <PlusIcon /> New note
            </Button>
          )}
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Note no.</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>B2B Lab</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending && (
              <TableRow>
                <TableCell colSpan={6}>
                  <Skeleton className="h-5 w-full" />
                </TableCell>
              </TableRow>
            )}
            {data?.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  No credit or debit notes in this period.
                </TableCell>
              </TableRow>
            )}
            {data?.map((n) => (
              <TableRow key={n.id}>
                <TableCell className="font-mono text-sm">{n.noteNo}</TableCell>
                <TableCell className="whitespace-nowrap">{fmtStamp(n.createdAt)}</TableCell>
                <TableCell>
                  <div className="font-medium">{n.account.name}</div>
                  <div className="text-xs text-muted-foreground">{n.account.code}</div>
                </TableCell>
                <TableCell>
                  <Badge variant={n.kind === "CREDIT" ? "secondary" : "outline"}>{n.kind === "CREDIT" ? "Credit" : "Debit"}</Badge>
                </TableCell>
                <TableCell className={`text-right tabular-nums ${n.kind === "CREDIT" ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                  {n.kind === "CREDIT" ? "+" : "−"}
                  {formatRupees(n.amountPaise)}
                </TableCell>
                <TableCell className="max-w-80 truncate text-sm" title={n.reason}>
                  {n.reason}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {adding && <NoteDialog onClose={() => setAdding(false)} />}
    </div>
  );
}
