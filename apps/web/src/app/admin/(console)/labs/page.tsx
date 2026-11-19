"use client";

import { useDeferredValue, useState } from "react";
import { PLAN_LABEL, TENANT_PLANS, TENANT_STATUS_LABEL, TENANT_STATUSES } from "@lms/shared";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/app-shell/page-header";
import { LabsTable } from "@/components/admin/labs-table";
import { useAdminLabs } from "@/lib/admin";

const ALL = "all";

export default function AdminLabsPage() {
  const [search, setSearch] = useState("");
  const [plan, setPlan] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const q = useDeferredValue(search.trim());
  const { data, isPending } = useAdminLabs(q, plan === ALL ? "" : plan, status === ALL ? "" : status);

  return (
    <>
      <title>Labs · Platform admin</title>
      <PageHeader title="Labs" description={data ? `${data.length} lab${data.length === 1 ? "" : "s"}` : "Every lab that has signed up."} />
      <div className="flex flex-wrap items-center gap-3">
        <InputGroup className="w-full bg-background sm:w-80">
          <InputGroupInput
            placeholder="Lab name, phone, or any user's email"
            aria-label="Search labs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </InputGroup>
        <Select value={plan} onValueChange={setPlan}>
          <SelectTrigger className="w-full sm:w-40 bg-background" aria-label="Plan">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All plans</SelectItem>
            {TENANT_PLANS.map((p) => (
              <SelectItem key={p} value={p}>
                {PLAN_LABEL[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-full sm:w-40 bg-background" aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {TENANT_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {TENANT_STATUS_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <LabsTable labs={data} loading={isPending} empty="No labs match." />
    </>
  );
}
