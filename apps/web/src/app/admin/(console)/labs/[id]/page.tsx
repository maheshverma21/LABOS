"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeftIcon, PencilIcon } from "lucide-react";
import {
  formatINR,
  formatTenure,
  PLAN_LABEL,
  TENANT_PLANS,
  TENANT_STATUS_LABEL,
  TENANT_STATUSES,
  type AdminLabDetail,
  type TenantPlan,
  type TenantStatus,
} from "@lms/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { AuditList } from "@/components/admin/audit-list";
import { LabStatusBadge, PlanBadge, RenewsOn } from "@/components/admin/badges";
import { UsersTable } from "@/components/admin/users-table";
import { LabAccessCard } from "@/components/admin/lab-access-card";
import { useAdminAuth } from "@/providers/admin-auth-provider";
import { adminApi } from "@/lib/admin-api";
import { adminKeys, fmtDate, fmtDateTime, useAdminLab } from "@/lib/admin";

function SubscriptionDialog({ lab, onOpenChange }: { lab: AdminLabDetail; onOpenChange: (o: boolean) => void }) {
  const queryClient = useQueryClient();
  const [plan, setPlan] = useState<TenantPlan>(lab.plan);
  const [status, setStatus] = useState<TenantStatus>(lab.status);
  const [renews, setRenews] = useState(lab.planRenewsAt ? lab.planRenewsAt.slice(0, 10) : "");
  const [reason, setReason] = useState("");

  const save = useMutation({
    mutationFn: () =>
      adminApi<{ lab: AdminLabDetail }>(`/labs/${lab.id}/subscription`, {
        method: "PUT",
        body: { plan, status, planRenewsAt: renews || null, reason },
      }),
    onSuccess: ({ lab: saved }) => {
      queryClient.setQueryData(adminKeys.lab(lab.id), saved);
      queryClient.invalidateQueries({ queryKey: adminKeys.all });
      toast.success("Subscription updated");
      onOpenChange(false);
    },
    onError: (err) => toast.error(err.message),
  });

  // Quick picks for the usual yearly renewal.
  const extend = (years: number) => {
    const base = renews && new Date(renews) > new Date() ? new Date(renews) : new Date();
    base.setFullYear(base.getFullYear() + years);
    setRenews(base.toISOString().slice(0, 10));
  };
  const suspending = status === "SUSPENDED" && lab.status !== "SUSPENDED";

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Subscription for {lab.name}</DialogTitle>
          <DialogDescription>Changes are logged with your name and reason, and show in the lab&apos;s own audit log.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="sub-plan">Plan</Label>
              <Select value={plan} onValueChange={(v) => setPlan(v as TenantPlan)}>
                <SelectTrigger id="sub-plan" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TENANT_PLANS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {PLAN_LABEL[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sub-status">Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as TenantStatus)}>
                <SelectTrigger id="sub-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TENANT_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {TENANT_STATUS_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sub-renews">Plan or trial ends on</Label>
            <div className="flex gap-2">
              <Input id="sub-renews" type="date" value={renews} onChange={(e) => setRenews(e.target.value)} className="flex-1" />
              <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => extend(1)}>
                +1 year
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Leave blank for no end date.</p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sub-reason">Reason</Label>
            <Textarea
              id="sub-reason"
              rows={2}
              placeholder="e.g. Paid invoice INV-104 for 2026-27"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          {suspending && (
            <Alert variant="destructive">
              <AlertDescription>
                Suspending signs out all {lab.activeUsers} user{lab.activeUsers === 1 ? "" : "s"} at once and stops their patient report links working.
              </AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter>
          <Button
            variant={suspending ? "destructive" : "default"}
            disabled={reason.trim().length < 3 || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending && <Spinner />}
            {suspending ? "Suspend lab" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-right">{v}</span>
    </div>
  );
}

export default function AdminLabPage() {
  const { id } = useParams<{ id: string }>();
  const { isSuper } = useAdminAuth();
  const { data: lab, isPending, error } = useAdminLab(id);
  const [editing, setEditing] = useState(false);

  if (isPending) return <Skeleton className="h-96 w-full" />;
  if (error || !lab) return <p className="text-sm text-destructive">{error?.message ?? "Lab not found"}</p>;

  return (
    <>
      <title>{`${lab.name} · Platform admin`}</title>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/admin/labs" aria-label="Back to labs">
            <ArrowLeftIcon />
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
            {lab.name} <PlanBadge plan={lab.plan} /> <LabStatusBadge status={lab.status} />
          </h1>
          <p className="text-sm text-muted-foreground">
            Customer for {formatTenure(lab.createdAt)} (since {fmtDate(lab.createdAt)}) · {lab.slug}
          </p>
        </div>
        {isSuper && (
          <Button onClick={() => setEditing(true)}>
            <PencilIcon /> Change subscription
          </Button>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Subscription</CardTitle>
          </CardHeader>
          <CardContent className="divide-y">
            <Row k="Plan" v={PLAN_LABEL[lab.plan]} />
            <Row k="Status" v={TENANT_STATUS_LABEL[lab.status]} />
            <Row k="Ends" v={lab.planRenewsAt ? <>{fmtDate(lab.planRenewsAt)} <RenewsOn iso={lab.planRenewsAt} className="block text-xs" /></> : "No end date"} />
            <Row k="Signed up" v={fmtDate(lab.createdAt)} />
            <Row k="Last activity" v={lab.lastActivityAt ? fmtDateTime(lab.lastActivityAt) : "Never"} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Contact</CardTitle>
          </CardHeader>
          <CardContent className="divide-y">
            <Row k="Owner" v={lab.owner ? lab.owner.name : "—"} />
            <Row k="Owner email" v={lab.owner?.email ?? "—"} />
            <Row k="Owner mobile" v={lab.owner?.phone ?? "—"} />
            <Row k="Lab phone" v={lab.phone ?? "—"} />
            <Row k="Lab email" v={lab.email ?? "—"} />
            <Row k="GSTIN" v={lab.gstin ?? "—"} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Usage</CardTitle>
          </CardHeader>
          <CardContent className="divide-y">
            <Row k="Users" v={`${lab.activeUsers} active of ${lab.users}`} />
            <Row k="Branches" v={lab.branchList.map((b) => b.name).join(", ") || "—"} />
            <Row k="Patients" v={lab.usage.patients.toLocaleString("en-IN")} />
            <Row k="Orders" v={`${lab.usage.orders30d} in 30 days · ${lab.usage.ordersTotal} in all`} />
            <Row k="Billed (30 days)" v={formatINR(lab.usage.billed30dPaise)} />
            <Row k="Reports sent (30 days)" v={lab.usage.reportsSent30d} />
            <Row k="Active tests in Test List" v={lab.usage.testsInCatalog} />
          </CardContent>
        </Card>
      </div>

      <LabAccessCard labId={lab.id} canEdit={isSuper} />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Users</h2>
        <UsersTable users={lab.userList} showLab={false} />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Admin history</h2>
        <AuditList items={lab.history} showLab={false} empty="No platform admin has changed anything for this lab." />
      </section>

      {editing && <SubscriptionDialog lab={lab} onOpenChange={setEditing} />}
    </>
  );
}
