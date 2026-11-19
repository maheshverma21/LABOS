"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileTextIcon, TagsIcon } from "lucide-react";
import { formatINR, type PortalOrderItem } from "@lms/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { fmtStamp } from "@/lib/accounts";
import { PreviewDialog, type Preview } from "@/components/reports/preview-dialog";
import { portalKeys } from "@/lib/portal";

function Status({ o }: { o: PortalOrderItem }) {
  if (o.status === "CANCELLED") return <Badge variant="destructive">Cancelled</Badge>;
  if (o.totalTests > 0 && o.approvedTests === o.totalTests) return <Badge>Report ready</Badge>;
  if (o.approvedTests > 0) return <Badge variant="secondary">Partly ready ({o.approvedTests}/{o.totalTests})</Badge>;
  return <Badge variant="outline">{o.settled ? "In the lab" : "Awaiting sample"}</Badge>;
}

export function OrdersTable({ orders, loading }: { orders: PortalOrderItem[]; loading?: boolean }) {
  const [cancelling, setCancelling] = useState<PortalOrderItem | null>(null);
  const [view, setView] = useState<{ order: PortalOrderItem; preview: Preview } | null>(null);
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Order</TableHead>
            <TableHead>Patient</TableHead>
            <TableHead>Tests</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading && (
            <TableRow>
              <TableCell colSpan={6}>
                <Skeleton className="h-5 w-full" />
              </TableCell>
            </TableRow>
          )}
          {!loading && orders.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                No orders yet.
              </TableCell>
            </TableRow>
          )}
          {orders.map((o) => (
            <TableRow key={o.id} className={o.status === "CANCELLED" ? "opacity-60" : undefined}>
              <TableCell>
                <div className="font-mono text-sm">{o.orderNo}</div>
                <div className="text-xs text-muted-foreground">{fmtStamp(o.createdAt)}</div>
              </TableCell>
              <TableCell>
                <div className="font-medium">{o.patient.name}</div>
                <div className="text-xs text-muted-foreground">{o.patient.uhid}</div>
              </TableCell>
              <TableCell className="max-w-64 truncate text-sm" title={o.tests.join(", ")}>
                {o.tests.join(", ")}
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatINR(o.netPaise)}</TableCell>
              <TableCell>
                <Status o={o} />
              </TableCell>
              <TableCell>
                <div className="flex justify-end gap-2">
                  {o.status === "ACTIVE" && (
                    <Button size="sm" variant="outline" onClick={() => setView({ order: o, preview: { kind: "barcode" } })}>
                      <TagsIcon /> Labels
                    </Button>
                  )}
                  {o.reportReady && (
                    <Button size="sm" onClick={() => setView({ order: o, preview: { kind: "report", opts: {} } })}>
                      <FileTextIcon /> Report
                    </Button>
                  )}
                  {o.cancellable && (
                    <Button size="sm" variant="outline" className="border-red-500 text-red-600 hover:text-red-600" onClick={() => setCancelling(o)}>
                      Cancel
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {view && (
        <PreviewDialog
          portal
          r={{ orderId: view.order.id, orderNo: view.order.orderNo, patient: { salutation: null, name: view.order.patient.name } }}
          preview={view.preview}
          onClose={() => setView(null)}
        />
      )}
      {cancelling && <CancelDialog order={cancelling} onClose={() => setCancelling(null)} />}
    </>
  );
}

function CancelDialog({ order, onClose }: { order: PortalOrderItem; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const cancel = useMutation({
    mutationFn: () => api(`/b2b/orders/${order.id}/cancel`, { method: "POST", body: { reason } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: portalKeys.all });
      await queryClient.invalidateQueries({ queryKey: ["accounts"] });
      toast.success("Order cancelled. The held amount is back in your wallet.");
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Cancel order {order.orderNo}?</DialogTitle>
          <DialogDescription>For {order.patient.name}. Only possible until the lab receives the sample.</DialogDescription>
        </DialogHeader>
        <Input aria-label="Reason" placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        <DialogFooter>
          <Button variant="destructive" disabled={reason.trim().length < 3 || cancel.isPending} onClick={() => cancel.mutate()}>
            {cancel.isPending && <Spinner />}
            Cancel order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
