"use client";

import { useState } from "react";
import { PLAN_LABEL, TENANT_STATUS_LABEL, type TenantPlan, type TenantStatus } from "@lms/shared";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { relativeDays } from "@/lib/admin";

const STATUS_STYLE: Record<TenantStatus, string> = {
  TRIAL: "border-sky-600/30 bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300",
  ACTIVE: "border-emerald-600/30 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
  SUSPENDED: "border-red-600/30 bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400",
};

export function LabStatusBadge({ status }: { status: TenantStatus }) {
  return (
    <Badge variant="outline" className={STATUS_STYLE[status]}>
      {TENANT_STATUS_LABEL[status]}
    </Badge>
  );
}

const PLAN_STYLE: Record<TenantPlan, string> = {
  STARTER: "",
  GROWTH: "border-violet-600/30 bg-violet-50 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300",
  ENTERPRISE: "border-amber-600/30 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
};

export function PlanBadge({ plan }: { plan: TenantPlan }) {
  return (
    <Badge variant="outline" className={PLAN_STYLE[plan]}>
      {PLAN_LABEL[plan]}
    </Badge>
  );
}

export function UserStatusBadge({ active }: { active: boolean }) {
  return (
    <Badge variant="outline" className={active ? STATUS_STYLE.ACTIVE : STATUS_STYLE.SUSPENDED}>
      {active ? "Active" : "Disabled"}
    </Badge>
  );
}

/** The plan end date, highlighted when it's close or past. */
export function RenewsOn({ iso, className }: { iso: string | null; className?: string }) {
  // The time when this mounted: close enough for whole days, and keeps render pure.
  const [now] = useState(() => Date.now());
  if (!iso) return <span className={cn("text-muted-foreground", className)}>No end date</span>;
  const days = (new Date(iso).getTime() - now) / 86_400_000;
  return (
    <span
      className={cn(
        days < 0 ? "font-medium text-destructive" : days <= 30 ? "font-medium text-amber-700 dark:text-amber-400" : "",
        className,
      )}
      title={new Date(iso).toLocaleDateString("en-IN")}
    >
      {days < 0 ? `Ended ${relativeDays(iso)}` : `Renews ${relativeDays(iso)}`}
    </span>
  );
}
