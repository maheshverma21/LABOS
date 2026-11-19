"use client";

import { useState } from "react";
import { BanIcon, PrinterIcon } from "lucide-react";
import { ORDER_TEST_STATUS_LABEL, sampleTypeLabel, type OrderDetail, type OrderSample } from "@lms/shared";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RejectSampleDialog } from "@/components/samples/reject-dialog";
import { SampleStatusBadge } from "@/components/samples/sample-status-badge";
import { useSampleActions } from "@/components/samples/use-sample-actions";
import { useAuth } from "@/providers/auth-provider";
import { formatDateTime } from "@/lib/orders";

export function OrderSamples({ order }: { order: OrderDetail }) {
  const { can } = useAuth();
  const { collect, receive } = useSampleActions();
  const [rejecting, setRejecting] = useState<OrderSample | null>(null);
  const active = order.status === "ACTIVE";
  const canWrite = can("samples:write") && active;
  const toLabel = order.samples.some((s) => s.status === "PENDING" || s.status === "COLLECTED");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Accession</CardTitle>
        <CardDescription>One tube per sample type. Scan the barcode at each step.</CardDescription>
        {active && toLabel && (
          <CardAction>
            <Button variant="outline" size="sm" asChild>
              <a href={`/print/labels/${order.id}`} target="_blank" rel="noreferrer">
                <PrinterIcon /> Print labels
              </a>
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        <ul className="divide-y rounded-lg border">
          {order.samples.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-medium">{s.barcode}</span>
                  <SampleStatusBadge status={s.status} />
                  <span className="text-muted-foreground">{s.container ?? sampleTypeLabel(s.sampleType)}</span>
                </div>
                <div className="text-muted-foreground">
                  {s.tests.map((t) => (
                    <span key={t.id} title={ORDER_TEST_STATUS_LABEL[t.status]} className="mr-2">
                      {t.code}
                    </span>
                  ))}
                </div>
                {s.rejectReason && <div className="text-destructive">Rejected: {s.rejectReason}</div>}
                {s.receivedAt && <div className="text-xs text-muted-foreground">Received {formatDateTime(s.receivedAt)}</div>}
                {!s.receivedAt && s.collectedAt && (
                  <div className="text-xs text-muted-foreground">Collected {formatDateTime(s.collectedAt)}</div>
                )}
              </div>
              {canWrite && (
                <div className="flex gap-2">
                  {s.status === "PENDING" && (
                    <Button variant="outline" size="sm" disabled={collect.isPending} onClick={() => collect.mutate([s.id])}>
                      Collected
                    </Button>
                  )}
                  {(s.status === "PENDING" || s.status === "COLLECTED") && (
                    <Button size="sm" disabled={receive.isPending} onClick={() => receive.mutate({ sampleIds: [s.id] })}>
                      Receive in lab
                    </Button>
                  )}
                  {(s.status === "COLLECTED" || s.status === "RECEIVED") && (
                    <Button variant="ghost" size="sm" onClick={() => setRejecting(s)}>
                      <BanIcon /> Reject
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
      <RejectSampleDialog sample={rejecting} onOpenChange={(open) => !open && setRejecting(null)} />
    </Card>
  );
}
