"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2Icon, CircleAlertIcon, LinkIcon, SendIcon } from "lucide-react";
import { formatMobile, normalizeIndianMobile, type ReportDeliveryItem } from "@lms/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/providers/auth-provider";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/orders";
import { HandOverButton, ReportPdfMenu } from "./report-actions";
import { copyText, reportKeys, useReportStatus } from "@/lib/reports";

/** "Sent", "Ready", "Partial" etc. for a report, from its counts. */
export function ReportProgress({ approved, total, amended }: { approved: number; total: number; amended?: boolean }) {
  if (approved === 0) return <span className="text-muted-foreground">Not ready</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge
        variant="outline"
        className={
          approved === total
            ? "border-emerald-600/30 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
            : "border-amber-600/30 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400"
        }
      >
        {approved === total ? "Ready" : `Partial ${approved}/${total}`}
      </Badge>
      {amended && <Badge variant="outline">Amended</Badge>}
    </span>
  );
}

export function DeliveryLine({ d }: { d: ReportDeliveryItem }) {
  const failed = d.status === "FAILED";
  return (
    <div className="flex gap-2 text-sm">
      {failed ? (
        <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
      ) : (
        <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-emerald-600" />
      )}
      <div className="min-w-0">
        <div>
          {d.channel === "COUNTER"
            ? `Handed over${d.to ? ` to ${d.to}` : " at the counter"}`
            : `${failed ? "Failed" : "Sent"} on WhatsApp${d.to ? ` to ${formatMobile(d.to)}` : ""}`}
        </div>
        <div className="text-xs text-muted-foreground">
          {formatDateTime(d.createdAt)}
          {d.sentBy && ` · ${d.sentBy}`}
        </div>
        {failed && d.error && <div className="text-xs text-destructive">{d.error}</div>}
      </div>
    </div>
  );
}

export function SendReportDialog({
  orderId,
  defaultMobile,
  open,
  onOpenChange,
}: {
  orderId: string;
  defaultMobile: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [to, setTo] = useState(defaultMobile ?? "");
  const mobile = normalizeIndianMobile(to);
  const send = useMutation({
    mutationFn: () =>
      api<{ delivery: ReportDeliveryItem }>(`/reports/${orderId}/send`, { method: "POST", body: { channel: "whatsapp", to: mobile } }),
    onSuccess: () => {
      toast.success(`Report sent to ${formatMobile(mobile!)}`);
      onOpenChange(false);
    },
    onError: (err) => toast.error(err.message),
    onSettled: () => queryClient.invalidateQueries({ queryKey: reportKeys.all }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Send report on WhatsApp</DialogTitle>
          <DialogDescription>The patient gets the PDF and can open it again from the link for 90 days.</DialogDescription>
        </DialogHeader>
        <form
          id="send-report"
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (mobile) send.mutate();
          }}
        >
          <Label htmlFor="send-to">Mobile number</Label>
          <Input id="send-to" inputMode="tel" value={to} onChange={(e) => setTo(e.target.value)} placeholder="98xxx xxxxx" autoFocus />
          {to && !mobile && <p className="text-sm text-destructive">Enter a 10-digit Indian mobile number.</p>}
        </form>
        <DialogFooter>
          <Button type="submit" form="send-report" disabled={!mobile || send.isPending}>
            {send.isPending ? <Spinner /> : <SendIcon />}
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The report panel on an order: view, send, share, and what was sent. */
export function ReportCard({ orderId, orderNo }: { orderId: string; orderNo: string }) {
  const { can } = useAuth();
  const { data: r, isPending } = useReportStatus(orderId);
  const [sendOpen, setSendOpen] = useState(false);

  const link = useMutation({
    mutationFn: () => api<{ url: string; expiresAt: string }>(`/reports/${orderId}/link`, { method: "POST" }),
    onSuccess: async ({ url }) => {
      try {
        await copyText(url);
        toast.success("Patient link copied", { description: url });
      } catch {
        toast.info("Patient link", { description: url, duration: 20_000 });
      }
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          Report
          {r && <ReportProgress approved={r.approvedTests} total={r.totalTests} amended={r.amended} />}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isPending ? (
          <Skeleton className="h-9 w-full" />
        ) : !r ? null : r.approvedTests === 0 ? (
          <p className="text-sm text-muted-foreground">The report is available once a pathologist approves the first results.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <ReportPdfMenu orderId={orderId} orderNo={orderNo} />
              {can("reports:deliver") && (
                <>
                  <Button size="sm" onClick={() => setSendOpen(true)} disabled={!r.whatsappReady}>
                    <SendIcon /> WhatsApp
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => link.mutate()} disabled={link.isPending}>
                    {link.isPending ? <Spinner /> : <LinkIcon />} Copy link
                  </Button>
                  {r.approvedTests === r.totalTests && <HandOverButton orderId={orderId} />}
                </>
              )}
            </div>
            {can("reports:deliver") && !r.whatsappReady && (
              <p className="text-xs text-muted-foreground">
                WhatsApp isn&apos;t set up for this lab.{" "}
                {can("settings:write") ? (
                  <Link href="/settings/lab#whatsapp" className="underline underline-offset-2">
                    Set it up
                  </Link>
                ) : (
                  "Ask the lab owner to set it up."
                )}
              </p>
            )}
            {r.approvedTests < r.totalTests && (
              <p className="text-xs text-muted-foreground">
                {r.totalTests - r.approvedTests} test{r.totalTests - r.approvedTests === 1 ? " is" : "s are"} still in progress; the report is
                marked partial.
              </p>
            )}
          </>
        )}
        {r && r.deliveries.length > 0 && (
          <div className="space-y-2 border-t pt-3">
            {r.deliveries.slice(0, 5).map((d) => (
              <DeliveryLine key={d.id} d={d} />
            ))}
          </div>
        )}
      </CardContent>
      {r && can("reports:deliver") && (
        <SendReportDialog
          key={String(sendOpen)}
          orderId={orderId}
          defaultMobile={r.patientMobile}
          open={sendOpen}
          onOpenChange={setSendOpen}
        />
      )}
    </Card>
  );
}
