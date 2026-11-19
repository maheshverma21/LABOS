"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeftIcon, BanIcon, ChevronDownIcon, FlaskConicalIcon, IndianRupeeIcon, PrinterIcon, CircleCheckIcon } from "lucide-react";
import {
  formatINR,
  formatMobile,
  patientDisplayName,
  PAYMENT_MODE_LABEL,
  PAYMENT_MODES,
  type OrderDetail,
  type PaymentMode,
} from "@lms/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { MoneyInput } from "@/components/inputs/money-input";
import { PageHeader } from "@/components/app-shell/page-header";
import { PaymentStatusBadge } from "@/components/payment-status-badge";
import { OrderSamples } from "./order-samples";
import { ReportCard } from "@/components/reports/report-card";
import { useAuth } from "@/providers/auth-provider";
import { api } from "@/lib/api";
import { APP_NAME } from "@/lib/brand";
import { formatDateTime, orderKeys, useOrder } from "@/lib/orders";
import { ageSex, patientKeys } from "@/lib/patients";

function useOrderUpdate(id: string, onDone: () => void) {
  const queryClient = useQueryClient();
  return async (order: OrderDetail) => {
    queryClient.setQueryData(orderKeys.detail(id), order);
    await queryClient.invalidateQueries({ queryKey: orderKeys.all });
    await queryClient.invalidateQueries({ queryKey: patientKeys.all });
    onDone();
  };
}

function CollectDialog({ order, open, onOpenChange }: { order: OrderDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [mode, setMode] = useState<PaymentMode>("CASH");
  const [amount, setAmount] = useState<number | null>(order.duePaise);
  const [reference, setReference] = useState("");
  const done = useOrderUpdate(order.id, () => onOpenChange(false));

  const collect = useMutation({
    mutationFn: () =>
      api<{ order: OrderDetail }>(`/orders/${order.id}/payments`, {
        method: "POST",
        body: { payments: [{ mode, amountPaise: amount, reference: reference || null }] },
      }),
    onSuccess: async ({ order: o }) => {
      toast.success(`Collected ${formatINR(amount ?? 0)}`);
      await done(o);
    },
    onError: (err) => toast.error(err.message),
  });
  const invalid = !amount || amount > order.duePaise;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Collect payment</DialogTitle>
          <DialogDescription>{formatINR(order.duePaise)} is due on this bill.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="flex gap-2">
            <Select value={mode} onValueChange={(v) => setMode(v as PaymentMode)}>
              <SelectTrigger className="w-28" aria-label="Payment mode">
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
            <MoneyInput aria-label="Amount" className="flex-1" value={amount} onChange={setAmount} autoFocus />
          </div>
          {mode !== "CASH" && (
            <Input placeholder="Reference" aria-label="Reference" value={reference} onChange={(e) => setReference(e.target.value)} />
          )}
          {amount != null && amount > order.duePaise && <p className="text-sm text-destructive">That&apos;s more than the amount due.</p>}
        </div>
        <DialogFooter>
          <Button disabled={invalid || collect.isPending} onClick={() => collect.mutate()}>
            {collect.isPending && <Spinner />}
            Collect {amount ? formatINR(amount) : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CancelDialog({ order, open, onOpenChange }: { order: OrderDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [reason, setReason] = useState("");
  const [refundMode, setRefundMode] = useState<PaymentMode>("CASH");
  const [reference, setReference] = useState("");
  const done = useOrderUpdate(order.id, () => onOpenChange(false));

  const cancel = useMutation({
    mutationFn: () =>
      api<{ order: OrderDetail }>(`/orders/${order.id}/cancel`, {
        method: "POST",
        body: { reason, refundMode: order.paidPaise > 0 ? refundMode : null, refundReference: reference || null },
      }),
    onSuccess: async ({ order: o }) => {
      toast.success("Order cancelled");
      await done(o);
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancel order {order.orderNo}?</DialogTitle>
          <DialogDescription>
            The bill stays on record, marked cancelled.
            {order.paidPaise > 0 && ` ${formatINR(order.paidPaise)} will be recorded as refunded.`}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="cancel-reason">Reason</Label>
            <Textarea id="cancel-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Patient left before sample collection" />
          </div>
          {order.paidPaise > 0 && (
            <div className="grid gap-1.5">
              <Label>Refund {formatINR(order.paidPaise)} by</Label>
              <div className="flex gap-2">
                <Select value={refundMode} onValueChange={(v) => setRefundMode(v as PaymentMode)}>
                  <SelectTrigger className="w-32" aria-label="Refund mode">
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
                {refundMode !== "CASH" && (
                  <Input className="flex-1" placeholder="Reference" aria-label="Refund reference" value={reference} onChange={(e) => setReference(e.target.value)} />
                )}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Keep order
          </Button>
          <Button variant="destructive" disabled={reason.trim().length < 3 || cancel.isPending} onClick={() => cancel.mutate()}>
            {cancel.isPending && <Spinner />}
            Cancel order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function OrderView({ id, justCreated }: { id: string; justCreated: boolean }) {
  const { can } = useAuth();
  const { data: o, isPending, error } = useOrder(id);
  const [collectOpen, setCollectOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  if (isPending) return <Skeleton className="h-96 w-full" />;
  if (error) {
    return (
      <PageHeader
        title="Order not found"
        description={error.message}
        actions={
          <Button variant="outline" asChild>
            <Link href="/patients">Back to Registration / Billing</Link>
          </Button>
        }
      />
    );
  }

  const cancelled = o.status === "CANCELLED";
  const billHref = `/print/bill/${o.id}`;

  return (
    <>
      <title>{`${o.orderNo} · ${patientDisplayName(o.patient)} · ${APP_NAME}`}</title>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/patients" aria-label="Back to Registration / Billing">
            <ArrowLeftIcon />
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight">
            <span className="font-mono">{o.orderNo}</span>
            <PaymentStatusBadge status={o.paymentStatus} />
          </h1>
          <p className="text-sm text-muted-foreground">
            Bill {o.billNo} · {formatDateTime(o.createdAt)}
            {o.branch && ` · ${o.branch.name}`}
            {o.createdBy && ` · by ${o.createdBy}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!cancelled && o.duePaise > 0 && can("billing:write") && (
            <Button onClick={() => setCollectOpen(true)}>
              <IndianRupeeIcon /> Collect {formatINR(o.duePaise)}
            </Button>
          )}
          {can("results:read") && o.samples.length > 0 && (
            <Button variant="outline" asChild>
              <Link href={`/results/${o.id}`}>
                <FlaskConicalIcon /> Results
              </Link>
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <PrinterIcon /> Print bill <ChevronDownIcon className="opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <a href={billHref} target="_blank" rel="noreferrer">
                  With letterhead
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href={`${billHref}?letterhead=0`} target="_blank" rel="noreferrer">
                  Without letterhead
                </a>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {!cancelled && can("billing:discount") && (
            <Button variant="outline" onClick={() => setCancelOpen(true)}>
              <BanIcon /> Cancel
            </Button>
          )}
        </div>
      </div>

      {justCreated && !cancelled && (
        <Alert>
          <CircleCheckIcon />
          <AlertTitle>Order created</AlertTitle>
          <AlertDescription>
            Print the bill, then the tube labels below.
          </AlertDescription>
        </Alert>
      )}
      {cancelled && (
        <Alert variant="destructive">
          <BanIcon />
          <AlertTitle>Cancelled {o.cancelledAt && formatDateTime(o.cancelledAt)}</AlertTitle>
          <AlertDescription>
            {o.cancelReason}
            {o.cancelledBy && ` (by ${o.cancelledBy})`}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <Card>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div>
                <div className="text-xs text-muted-foreground">Patient</div>
                <Link href={`/patients/${o.patient.id}`} className="font-medium hover:underline">
                  {patientDisplayName(o.patient)}
                </Link>
                <div className="text-sm text-muted-foreground">
                  {o.patient.uhid} · {ageSex(o.patient)}
                  {o.patient.phone && ` · ${formatMobile(o.patient.phone)}`}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Referred by</div>
                <div className="font-medium">{o.doctor?.name ?? "Self"}</div>
                {o.priceList && <div className="text-sm text-muted-foreground">Rates: {o.priceList.name}</div>}
              </div>
              {o.notes && (
                <div className="sm:col-span-2">
                  <div className="text-xs text-muted-foreground">Notes</div>
                  <div className="text-sm">{o.notes}</div>
                </div>
              )}
            </CardContent>
          </Card>

          {o.samples.length > 0 && <OrderSamples order={o} />}

          <Card>
            <CardHeader>
              <CardTitle>Tests</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">Code</TableHead>
                    <TableHead>Test</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {o.items.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="font-mono text-xs">{i.code}</TableCell>
                      <TableCell>
                        {i.name}
                        {i.isPanel && (
                          <Badge variant="secondary" className="ml-2">
                            Panel
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {i.pricePaise !== i.basePricePaise && (
                          <span className="mr-2 text-xs text-muted-foreground line-through">{formatINR(i.basePricePaise)}</span>
                        )}
                        {formatINR(i.pricePaise)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
        {!cancelled && can("reports:read") && o.samples.length > 0 && <ReportCard orderId={o.id} orderNo={o.orderNo} />}
        <Card>
          <CardHeader>
            <CardTitle>Payment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span className="tabular-nums">{formatINR(o.grossPaise)}</span>
            </div>
            {o.discountPaise > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span>
                  Discount{o.discountType === "PERCENT" && ` (${o.discountValue}%)`}
                  {o.discountReason && <span className="block text-xs">{o.discountReason}</span>}
                </span>
                <span className="tabular-nums">− {formatINR(o.discountPaise)}</span>
              </div>
            )}
            <Separator />
            <div className="flex justify-between text-base font-semibold">
              <span>Total</span>
              <span className="tabular-nums">{formatINR(o.netPaise)}</span>
            </div>
            <ul className="space-y-1.5 pt-2">
              {o.payments.map((p) => (
                <li key={p.id} className="flex justify-between gap-2">
                  <span>
                    {p.kind === "REFUND" ? "Refund" : "Paid"} · {PAYMENT_MODE_LABEL[p.mode]}
                    <span className="block text-xs text-muted-foreground">
                      {formatDateTime(p.createdAt)}
                      {p.receivedBy && ` · ${p.receivedBy}`}
                      {p.reference && ` · ${p.reference}`}
                    </span>
                  </span>
                  <span className="tabular-nums">
                    {p.kind === "REFUND" ? "− " : ""}
                    {formatINR(p.amountPaise)}
                  </span>
                </li>
              ))}
              {o.payments.length === 0 && <li className="text-muted-foreground">Nothing paid yet.</li>}
            </ul>
            {o.account && (
              <div className="rounded-md border bg-sky-50/60 p-2 text-sky-900 dark:bg-sky-950/30 dark:text-sky-200">
                Billed to{" "}
                {can("accounts:read") ? (
                  <Link href="/b2b" className="font-medium underline-offset-2 hover:underline">
                    {o.account.name}
                  </Link>
                ) : (
                  <span className="font-medium">{o.account.name}</span>
                )}
                <div className="text-xs">
                  {o.invoice ? (
                    <a href={`/print/invoice/${o.invoice.id}`} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
                      On invoice {o.invoice.invoiceNo}
                    </a>
                  ) : (
                    "Not invoiced yet"
                  )}
                </div>
              </div>
            )}
            {!cancelled && (
              <div className={o.duePaise > 0 ? "flex justify-between pt-2 font-medium text-amber-700 dark:text-amber-400" : "flex justify-between pt-2 font-medium"}>
                <span>Balance due</span>
                <span className="tabular-nums">{formatINR(o.duePaise)}</span>
              </div>
            )}
          </CardContent>
        </Card>
        </div>
      </div>

      {can("billing:write") && <CollectDialog key={`c-${o.duePaise}`} order={o} open={collectOpen} onOpenChange={setCollectOpen} />}
      {can("billing:discount") && <CancelDialog order={o} open={cancelOpen} onOpenChange={setCancelOpen} />}
    </>
  );
}
