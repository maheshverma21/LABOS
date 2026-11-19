"use client";

import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/app-shell/page-header";
import { AuditList } from "@/components/admin/audit-list";
import { useAdminAudit, useAdminLabs } from "@/lib/admin";

const ALL = "all";

export default function AdminAuditPage() {
  const [labId, setLabId] = useState(ALL);
  const labs = useAdminLabs("", "", "");
  const { data, isPending, error } = useAdminAudit(labId === ALL ? "" : labId);

  return (
    <>
      <title>Audit log · Platform admin</title>
      <PageHeader title="Audit log" description="Everything platform admins have done: sign-ins, subscription changes, user actions. Latest 200." />
      <Select value={labId} onValueChange={setLabId}>
        <SelectTrigger className="w-full sm:w-60 bg-background" aria-label="Lab">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All labs and admin sign-ins</SelectItem>
          {labs.data?.map((l) => (
            <SelectItem key={l.id} value={l.id}>
              {l.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && <p className="text-sm text-destructive">{error.message}</p>}
      {isPending ? <Skeleton className="h-40 w-full" /> : <AuditList items={data ?? []} />}
    </>
  );
}
