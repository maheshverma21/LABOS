"use client";

import { PLAN_LABEL, TENANT_PLANS, TENANT_STATUS_LABEL, TENANT_STATUSES } from "@lms/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/app-shell/page-header";
import { LabsTable } from "@/components/admin/labs-table";
import { useOverview } from "@/lib/admin";

function Stat({ label, value, sub }: { label: string; value: number | string; sub?: React.ReactNode }) {
  return (
    <Card className="gap-1 py-4">
      <CardContent className="space-y-1 px-4">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="text-3xl font-semibold tabular-nums">{value}</div>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

export default function AdminOverviewPage() {
  const { data: o, isPending, error } = useOverview();
  return (
    <>
      <title>Overview · Platform admin</title>
      <PageHeader title="Overview" description="Every lab on the platform at a glance." />
      {error && <p className="text-sm text-destructive">{error.message}</p>}
      {isPending || !o ? (
        <Skeleton className="h-28 w-full" />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Labs"
              value={o.labs.total}
              sub={TENANT_STATUSES.map((s) => `${o.labs.byStatus[s]} ${TENANT_STATUS_LABEL[s].toLowerCase()}`).join(" · ")}
            />
            <Stat label="New labs (30 days)" value={o.labs.new30d} sub={TENANT_PLANS.map((p) => `${o.labs.byPlan[p]} ${PLAN_LABEL[p]}`).join(" · ")} />
            <Stat label="Users" value={o.users.active} sub={`${o.users.total} in all · ${o.users.signedIn30d} signed in this month`} />
            <Stat label="Orders (30 days)" value={o.orders30d.toLocaleString("en-IN")} sub="across all labs" />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Renewals due</CardTitle>
              <CardDescription>Labs whose plan or trial ends within 30 days, or has already ended.</CardDescription>
            </CardHeader>
            <CardContent>
              <LabsTable labs={o.renewals} empty="Nothing due in the next 30 days." />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Newest labs</CardTitle>
            </CardHeader>
            <CardContent>
              <LabsTable labs={o.recentLabs} />
            </CardContent>
          </Card>
        </>
      )}
    </>
  );
}
