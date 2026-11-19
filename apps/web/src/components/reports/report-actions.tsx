"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDownIcon, FileTextIcon, HandIcon, PrinterIcon } from "lucide-react";
import { REPORT_STATE_LABEL, type ReportState } from "@lms/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api";
import { useTemplates } from "@/lib/branding";
import { openReportPdf, reportKeys } from "@/lib/reports";
import { cn } from "@/lib/utils";

/** Colours for where a report stands: amber pending, blue completed, green delivered. */
export const REPORT_STATE_STYLE: Record<ReportState, { badge: string; bar: string; dot: string; row: string }> = {
  PENDING: {
    badge: "border-amber-600/30 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
    bar: "border-l-amber-500",
    dot: "bg-amber-500",
    row: "bg-amber-200 hover:bg-amber-300 dark:bg-amber-900/60 dark:hover:bg-amber-900/80",
  },
  COMPLETED: {
    badge: "border-sky-600/30 bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300",
    bar: "border-l-sky-500",
    dot: "bg-sky-500",
    row: "bg-sky-200 hover:bg-sky-300 dark:bg-sky-900/60 dark:hover:bg-sky-900/80",
  },
  DELIVERED: {
    badge: "border-emerald-600/30 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
    bar: "border-l-emerald-500",
    dot: "bg-emerald-500",
    row: "bg-emerald-200 hover:bg-emerald-300 dark:bg-emerald-900/60 dark:hover:bg-emerald-900/80",
  },
};

export function ReportStateBadge({ state, className }: { state: ReportState; className?: string }) {
  return (
    <Badge variant="outline" className={cn(REPORT_STATE_STYLE[state].badge, className)}>
      <span className={cn("size-1.5 rounded-full", REPORT_STATE_STYLE[state].dot)} aria-hidden />
      {REPORT_STATE_LABEL[state]}
    </Badge>
  );
}

/** Opens the report PDF: with the lab's letterhead, without it (for letterhead paper), or with another saved letterhead. */
export function ReportPdfMenu({
  orderId,
  orderNo,
  size = "sm",
  variant = "outline",
  label = "Print / PDF",
}: {
  orderId: string;
  orderNo: string;
  size?: "sm" | "default";
  variant?: "outline" | "ghost";
  label?: string;
}) {
  const { data: templates } = useTemplates();
  const [opening, setOpening] = useState(false);
  const others = (templates ?? []).filter((t) => !t.isDefault);

  async function open(opts: { templateId?: string; letterhead?: boolean; outsource?: boolean }) {
    setOpening(true);
    try {
      await openReportPdf(orderId, `Report-${orderNo}.pdf`, opts);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't open the report");
    } finally {
      setOpening(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size={size} disabled={opening}>
          {opening ? <Spinner /> : <FileTextIcon />} {label} <ChevronDownIcon className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuItem onSelect={() => open({})}>
          <PrinterIcon /> Print with letterhead
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => open({ letterhead: false })}>
          <FileTextIcon /> Print without letterhead
          <span className="ml-auto pl-3 text-xs text-muted-foreground">for letterhead paper</span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => open({ outsource: true })}>
          <FileTextIcon /> Outsource report
        </DropdownMenuItem>
        {others.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Other letterheads</DropdownMenuLabel>
            {others.map((t) => (
              <DropdownMenuItem key={t.id} onSelect={() => open({ templateId: t.id })}>
                {t.name}
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Records that the printed report was handed over at the counter, which marks it delivered. */
export function HandOverButton({ orderId, size = "sm", variant = "outline" }: { orderId: string; size?: "sm" | "default"; variant?: "outline" | "ghost" }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const save = useMutation({
    mutationFn: () => api(`/reports/${orderId}/handed-over`, { method: "POST", body: { to } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: reportKeys.all });
      toast.success("Marked as delivered");
      setOpen(false);
      setTo("");
    },
    onError: (err) => toast.error(err.message),
  });
  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)}>
        <HandIcon /> Handed over
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Report handed over</DialogTitle>
            <DialogDescription>Marks the report as delivered. It goes back to completed if results are changed later.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="ho-to">Collected by (optional)</Label>
            <Input id="ho-to" placeholder="e.g. Patient, or their son Rahul" maxLength={80} value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <DialogFooter>
            <Button disabled={save.isPending} onClick={() => save.mutate()}>
              {save.isPending && <Spinner />}
              Mark delivered
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
