"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { EllipsisVerticalIcon, FilePlus2Icon, IndianRupeeIcon, PencilIcon, Trash2Icon, XIcon } from "lucide-react";
import {
  formatINR,
  patientDisplayName,
  PAYMENT_MODE_LABEL,
  PAYMENT_MODES,
  type PaymentMode,
  type ReportListItem,
} from "@lms/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { MoneyInput } from "@/components/inputs/money-input";
import { PatientForm } from "@/app/(app)/patients/_components/patient-form";
import { useAuth } from "@/providers/auth-provider";
import { api } from "@/lib/api";
import { useTests } from "@/lib/catalog";
import { orderKeys, useOrder } from "@/lib/orders";
import { patientKeys, usePatient } from "@/lib/patients";
import { reportKeys } from "@/lib/reports";

type Dlg = "due" | "patient" | "tests" | "delete" | null;

/** Refreshes every list that shows this order, its patient or the day's collections. */
function useRefresh() {
  const qc = useQueryClient();
  return async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: reportKeys.all }),
      qc.invalidateQueries({ queryKey: orderKeys.all }),
      qc.invalidateQueries({ queryKey: patientKeys.all }),
      qc.invalidateQueries({ queryKey: ["collections"] }),
    ]);
  };
}

function ModeSelect({ value, onChange, label }: { value: PaymentMode; onChange: (m: PaymentMode) => void; label: string }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as PaymentMode)}>
      <SelectTrigger className="w-32" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PAYMENT_MODES.map((m) => (
          <SelectItem key={m} value={m}>
            {PAYMENT_MODE_LABEL[m]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ClearDueDialog({ r, onClose }: { r: ReportListItem; onClose: () => void }) {
  const due = r.netPaise - r.paidPaise;
  const [mode, setMode] = useState<PaymentMode>("CASH");
  const [amount, setAmount] = useState<number | null>(due);
  const [reference, setReference] = useState("");
  const refresh = useRefresh();

  const collect = useMutation({
    mutationFn: () =>
      api(`/orders/${r.orderId}/payments`, {
        method: "POST",
        body: { payments: [{ mode, amountPaise: amount, reference: reference || null }] },
      }),
    onSuccess: async () => {
      toast.success(`Collected ${formatINR(amount ?? 0)}`);
      await refresh();
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });
  const invalid = !amount || amount > due;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Clear due · {r.orderNo}</DialogTitle>
          <DialogDescription>
            {formatINR(due)} is due from {patientDisplayName(r.patient)}.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="flex gap-2">
            <ModeSelect value={mode} onChange={setMode} label="Payment mode" />
            <MoneyInput aria-label="Amount" className="flex-1" value={amount} onChange={setAmount} autoFocus />
          </div>
          {mode !== "CASH" && (
            <Input placeholder="Reference" aria-label="Reference" value={reference} onChange={(e) => setReference(e.target.value)} />
          )}
          {amount != null && amount > due && <p className="text-sm text-destructive">That&apos;s more than the amount due.</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button disabled={invalid || collect.isPending} onClick={() => collect.mutate()}>
            {collect.isPending && <Spinner />}
            Collect {amount ? formatINR(amount) : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditPatientDialog({ r, onClose }: { r: ReportListItem; onClose: () => void }) {
  const { data: patient, isPending, error } = usePatient(r.patient.id);
  const refresh = useRefresh();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Edit patient</DialogTitle>
          <DialogDescription>{patientDisplayName(r.patient)}</DialogDescription>
        </DialogHeader>
        {isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : error ? (
          <p className="text-sm text-destructive">{error.message}</p>
        ) : (
          <PatientForm
            key={patient.updatedAt}
            patient={patient}
            onSaved={async () => {
              toast.success("Patient saved");
              await refresh();
              onClose();
            }}
            onCancel={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Adds tests that were forgotten at billing. The bill is worked out again, and the new tests start at Accession. */
function AddTestsDialog({ r, onClose }: { r: ReportListItem; onClose: () => void }) {
  const { data: order, isPending, error } = useOrder(r.orderId);
  const tests = useTests();
  const [picked, setPicked] = useState<string[]>([]);
  const qc = useQueryClient();

  const byId = new Map((tests.data ?? []).map((x) => [x.id, x]));
  const onBill = new Set(order?.items.map((i) => i.testId) ?? []);
  const options = (tests.data ?? []).filter((x) => !onBill.has(x.id) && !picked.includes(x.id));
  const total = picked.reduce((a, id) => a + (byId.get(id)?.pricePaise ?? 0), 0);

  const add = useMutation({
    mutationFn: () => api(`/orders/${r.orderId}/tests`, { method: "POST", body: { testIds: picked } }),
    onSuccess: async () => {
      toast.success(picked.length === 1 ? "Test added. It's now in Accession." : `${picked.length} tests added. They're now in Accession.`);
      await qc.invalidateQueries();
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit bill · {r.orderNo}</DialogTitle>
          <DialogDescription>
            Add tests that were left out. They go to Accession first, then to Results once the sample is collected.
          </DialogDescription>
        </DialogHeader>
        {isPending || tests.isPending ? (
          <Skeleton className="h-48 w-full" />
        ) : error ? (
          <p className="text-sm text-destructive">{error.message}</p>
        ) : (
          <div className="grid min-h-0 gap-3 overflow-y-auto">
            <div className="grid gap-1">
              <Label>On the bill</Label>
              <div className="rounded-lg border">
                {order.items.map((i) => (
                  <div key={i.id} className="flex justify-between border-b px-3 py-1.5 text-sm last:border-b-0">
                    <span>
                      {i.name} <span className="font-mono text-xs text-muted-foreground">{i.code}</span>
                    </span>
                    <span className="tabular-nums">{formatINR(i.pricePaise)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="grid gap-1">
              <Label>Add tests</Label>
              <Command className="rounded-lg border">
                <CommandInput placeholder="Search test by name or code" />
                <CommandList className="max-h-48">
                  <CommandEmpty>No test found.</CommandEmpty>
                  <CommandGroup>
                    {options.map((x) => (
                      <CommandItem key={x.id} value={`${x.name} ${x.code}`} onSelect={() => setPicked((p) => [...p, x.id])}>
                        <span className="flex-1">
                          {x.name} <span className="font-mono text-xs text-muted-foreground">{x.code}</span>
                        </span>
                        <span className="tabular-nums text-muted-foreground">{formatINR(x.pricePaise)}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </div>
            {picked.length > 0 && (
              <div className="grid gap-1">
                <Label>Adding</Label>
                <div className="rounded-lg border">
                  {picked.map((id) => (
                    <div key={id} className="flex items-center justify-between gap-2 border-b px-3 py-1.5 text-sm last:border-b-0">
                      <span className="flex-1">{byId.get(id)?.name}</span>
                      <span className="tabular-nums">{formatINR(byId.get(id)?.pricePaise ?? 0)}</span>
                      <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove" onClick={() => setPicked((p) => p.filter((x) => x !== id))}>
                        <XIcon />
                      </Button>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  About {formatINR(total)} more at list prices. The bill&apos;s price list and discount are applied when you save.
                </p>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button disabled={picked.length === 0 || add.isPending} onClick={() => add.mutate()}>
            {add.isPending && <Spinner />}
            Add {picked.length || ""} {picked.length === 1 ? "test" : "tests"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Deleting a bill cancels it: the record stays, marked cancelled, and anything paid is refunded. */
function DeleteBillDialog({ r, onClose }: { r: ReportListItem; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [refundMode, setRefundMode] = useState<PaymentMode>("CASH");
  const [reference, setReference] = useState("");
  const refresh = useRefresh();

  const del = useMutation({
    mutationFn: () =>
      api(`/orders/${r.orderId}/cancel`, {
        method: "POST",
        body: { reason, refundMode: r.paidPaise > 0 ? refundMode : null, refundReference: reference || null },
      }),
    onSuccess: async () => {
      toast.success("Bill deleted");
      await refresh();
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete bill {r.orderNo}?</DialogTitle>
          <DialogDescription>
            The bill is removed from reports and kept on record as cancelled. This can&apos;t be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="delete-reason">Reason</Label>
            <Textarea id="delete-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Entered by mistake" />
          </div>
          {r.paidPaise > 0 && (
            <div className="grid gap-1.5">
              <Label>Refund {formatINR(r.paidPaise)} by</Label>
              <div className="flex gap-2">
                <ModeSelect value={refundMode} onChange={setRefundMode} label="Refund mode" />
                {refundMode !== "CASH" && (
                  <Input className="flex-1" placeholder="Reference" aria-label="Refund reference" value={reference} onChange={(e) => setReference(e.target.value)} />
                )}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Keep bill
          </Button>
          <Button variant="destructive" disabled={reason.trim().length < 3 || del.isPending} onClick={() => del.mutate()}>
            {del.isPending && <Spinner />}
            Delete bill
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The ⋮ menu at the end of each report row: clear due, edit patient, delete bill. */
export function ReportRowMenu({ r }: { r: ReportListItem }) {
  const { can } = useAuth();
  const [dlg, setDlg] = useState<Dlg>(null);
  const due = r.netPaise - r.paidPaise;
  const canDue = can("billing:write") && due > 0;
  const canEdit = can("patients:write");
  const canTests = can("orders:write") && can("billing:write") && !r.account;
  const canDelete = can("billing:discount");
  if (!canDue && !canEdit && !canDelete && !canTests) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon-sm" aria-label="More actions">
            <EllipsisVerticalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          {canDue && (
            <DropdownMenuItem onSelect={() => setDlg("due")}>
              <IndianRupeeIcon /> Clear due
            </DropdownMenuItem>
          )}
          {canTests && (
            <DropdownMenuItem onSelect={() => setDlg("tests")}>
              <FilePlus2Icon /> Edit bill (add tests)
            </DropdownMenuItem>
          )}
          {canEdit && (
            <DropdownMenuItem onSelect={() => setDlg("patient")}>
              <PencilIcon /> Edit patient
            </DropdownMenuItem>
          )}
          {canDelete && (
            <>
              {(canDue || canEdit || canTests) && <DropdownMenuSeparator />}
              <DropdownMenuItem variant="destructive" onSelect={() => setDlg("delete")}>
                <Trash2Icon /> Delete bill
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {dlg === "due" && <ClearDueDialog r={r} onClose={() => setDlg(null)} />}
      {dlg === "tests" && <AddTestsDialog r={r} onClose={() => setDlg(null)} />}
      {dlg === "patient" && <EditPatientDialog r={r} onClose={() => setDlg(null)} />}
      {dlg === "delete" && <DeleteBillDialog r={r} onClose={() => setDlg(null)} />}
    </>
  );
}
