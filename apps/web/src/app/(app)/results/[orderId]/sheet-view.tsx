"use client";

import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useState } from "react";
import { ArrowLeftIcon, CheckCheckIcon } from "lucide-react";
import { ageOn, formatAge, patientDisplayName, SEX_LABEL, todayIST } from "@lms/shared";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { PageHeader } from "@/components/app-shell/page-header";
import { useAuth } from "@/providers/auth-provider";
import { api } from "@/lib/api";
import { APP_NAME } from "@/lib/brand";
import { formatDateTime, orderKeys } from "@/lib/orders";
import { resultKeys, useSheet } from "@/lib/results";
import { reportKeys } from "@/lib/reports";
import { PreviewDialog } from "@/components/reports/preview-dialog";
import { TestCard } from "./test-card";

export function SheetView({ orderId }: { orderId: string }) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const { data: sheet, isPending, error } = useSheet(orderId);

  const submitted = sheet?.tests.filter((t) => t.status === "SUBMITTED") ?? [];
  const anyApproved = !!sheet?.tests.some((t) => t.status === "APPROVED");
  const [printing, setPrinting] = useState(false);
  const approveAll = useMutation({
    mutationFn: () => api("/results/approve", { method: "POST", body: { orderTestIds: submitted.map((t) => t.orderTestId) } }),
    onSuccess: async () => {
      toast.success(`Approved ${submitted.length} ${submitted.length === 1 ? "test" : "tests"}`);
      await queryClient.invalidateQueries({ queryKey: resultKeys.all });
      await queryClient.invalidateQueries({ queryKey: orderKeys.all });
      await queryClient.invalidateQueries({ queryKey: reportKeys.all });
    },
    onError: (err) => toast.error(err.message),
  });

  if (isPending) return <Skeleton className="h-96 w-full" />;
  if (error) {
    return (
      <PageHeader
        title="Order not found"
        description={error.message}
        actions={
          <Button variant="outline" asChild>
            <Link href="/results">Back to results</Link>
          </Button>
        }
      />
    );
  }

  const p = sheet.patient;
  return (
    <>
      <title>{`Results ${sheet.order.orderNo} · ${patientDisplayName(p)} · ${APP_NAME}`}</title>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/results" aria-label="Back to results">
            <ArrowLeftIcon />
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{patientDisplayName(p)}</h1>
          <p className="text-sm text-muted-foreground">
            {p.dobEstimated ? "~" : ""}
            {formatAge(ageOn(p.dob, todayIST(new Date(sheet.order.createdAt))))} · {SEX_LABEL[p.sex]} · {p.uhid} ·{" "}
            <Link href={`/orders/${sheet.order.id}`} className="font-mono hover:underline">
              {sheet.order.orderNo}
            </Link>{" "}
            · {formatDateTime(sheet.order.createdAt)}
            {sheet.order.doctor && ` · ${sheet.order.doctor}`}
          </p>
        </div>
        {can("results:approve") && submitted.length > 1 && (
          <Button disabled={approveAll.isPending} onClick={() => approveAll.mutate()}>
            {approveAll.isPending ? <Spinner /> : <CheckCheckIcon />}
            Approve all {submitted.length}
          </Button>
        )}
      </div>

      {sheet.order.status === "CANCELLED" && <p className="text-sm text-destructive">This order is cancelled.</p>}

      <div className="space-y-6">
        {sheet.tests.map((t) => (
          // Re-mount after each save so the form shows what the server now holds.
          <TestCard key={`${t.orderTestId}-${t.status}-${t.enteredAt}-${t.approvedAt}`} test={t} sheet={sheet} onPrint={() => setPrinting(true)} />
        ))}
      </div>
      {printing && anyApproved && (
        <PreviewDialog
          r={{ orderId: sheet.order.id, orderNo: sheet.order.orderNo, patient: p }}
          preview={{ kind: "report", opts: {} }}
          onClose={() => setPrinting(false)}
        />
      )}
    </>
  );
}
