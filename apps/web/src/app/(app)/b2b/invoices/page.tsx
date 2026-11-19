"use client";

import { useState } from "react";
import { FileTextIcon, PlusIcon } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { formatINR, previousMonth, todayIST, type InvoiceDetail } from "@lms/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LabPicker } from "@/components/b2b/lab-picker";
import { useAuth } from "@/providers/auth-provider";
import { api } from "@/lib/api";
import { accountKeys, fmtIsoDate, useInvoices } from "@/lib/accounts";

const ANY = "any";

export default function InvoicesPage() {
  const { can } = useAuth();
  const [labId, setLabId] = useState("");
  const [status, setStatus] = useState("");
  const { data, isPending } = useInvoices(status, labId);
  const [creating, setCreating] = useState(false);
  const [voiding, setVoiding] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <LabPicker value={labId} onChange={setLabId} allLabel="All B2B labs" />
        <Select value={status || ANY} onValueChange={(v) => setStatus(v === ANY ? "" : v)}>
          <SelectTrigger className="w-40" aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All invoices</SelectItem>
            <SelectItem value="PAID">Issued</SelectItem>
            <SelectItem value="VOID">Void</SelectItem>
          </SelectContent>
        </Select>
        {can("accounts:write") && (
          <Button className="ml-auto" onClick={() => setCreating(true)}>
            <PlusIcon /> New invoice
          </Button>
        )}
      </div>
      <p className="text-sm text-muted-foreground">An invoice is a statement of the orders already taken from a lab&apos;s wallet in a period. It takes nothing more from the wallet.</p>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice no.</TableHead>
              <TableHead>B2B Lab</TableHead>
              <TableHead>Period</TableHead>
              <TableHead className="text-right">Orders</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
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
            {data?.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  No invoices.
                </TableCell>
              </TableRow>
            )}
            {data?.map((i) => (
              <TableRow key={i.id}>
                <TableCell className="font-mono text-sm">{i.invoiceNo}</TableCell>
                <TableCell>{i.account.name}</TableCell>
                <TableCell className="whitespace-nowrap text-sm">
                  {fmtIsoDate(i.periodFrom)} – {fmtIsoDate(i.periodTo)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{i.status === "VOID" ? "—" : i.orderCount}</TableCell>
                <TableCell className="text-right tabular-nums">{formatINR(i.totalPaise)}</TableCell>
                <TableCell>{i.status === "VOID" ? <Badge variant="destructive">Void</Badge> : <Badge variant="secondary">Issued</Badge>}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="outline" asChild>
                      <a href={`/print/invoice/${i.id}`} target="_blank" rel="noopener noreferrer">
                        <FileTextIcon /> View
                      </a>
                    </Button>
                    {can("accounts:write") && i.status !== "VOID" && (
                      <Button size="sm" variant="outline" className="border-red-500 text-red-600 hover:text-red-600" onClick={() => setVoiding(i.id)}>
                        Void
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {creating && <CreateInvoiceDialog initialLab={labId} onClose={() => setCreating(false)} />}
      {voiding && <VoidDialog id={voiding} onClose={() => setVoiding(null)} />}
    </div>
  );
}

function CreateInvoiceDialog({ initialLab, onClose }: { initialLab: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const last = previousMonth(todayIST());
  const [labId, setLabId] = useState(initialLab);
  const [from, setFrom] = useState(last.from);
  const [to, setTo] = useState(last.to);
  const create = useMutation({
    mutationFn: () => api<{ invoice: InvoiceDetail }>(`/accounts/${labId}/invoices`, { method: "POST", body: { periodFrom: from, periodTo: to } }),
    onSuccess: async ({ invoice }) => {
      await queryClient.invalidateQueries({ queryKey: accountKeys.all });
      toast.success(`${invoice.invoiceNo} created`);
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New invoice</DialogTitle>
          <DialogDescription>Every order of the period that the wallet has been charged for, and that isn&apos;t on an invoice yet. Last month is filled in.</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel>B2B lab</FieldLabel>
            <LabPicker value={labId} onChange={setLabId} className="w-full" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="inv-from">From</FieldLabel>
              <Input id="inv-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="inv-to">To</FieldLabel>
              <Input id="inv-to" type="date" value={to} min={from} max={todayIST()} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </div>
        </FieldGroup>
        <DialogFooter>
          <Button disabled={!labId || !from || !to || create.isPending} onClick={() => create.mutate()}>
            {create.isPending && <Spinner />}
            Create invoice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VoidDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const voidIt = useMutation({
    mutationFn: () => api(`/invoices/${id}/void`, { method: "POST", body: { reason } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: accountKeys.all });
      toast.success("Invoice voided. Its orders can go on a new one.");
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Void this invoice?</DialogTitle>
          <DialogDescription>Its orders are released so they can be invoiced again. The wallet isn&apos;t affected.</DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="void-reason">Reason</FieldLabel>
          <Input id="void-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="destructive" disabled={reason.trim().length < 3 || voidIt.isPending} onClick={() => voidIt.mutate()}>
            {voidIt.isPending && <Spinner />}
            Void invoice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
