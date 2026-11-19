"use client";

import { useDeferredValue, useState } from "react";
import { SYSTEM_ROLES } from "@lms/shared";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/app-shell/page-header";
import { UsersTable } from "@/components/admin/users-table";
import { useAdminLabs, useAdminUsers } from "@/lib/admin";

const ALL = "all";

export default function AdminUsersPage() {
  const [search, setSearch] = useState("");
  const [labId, setLabId] = useState(ALL);
  const [role, setRole] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const q = useDeferredValue(search.trim());
  const labs = useAdminLabs("", "", "");
  const { data, isPending } = useAdminUsers(q, labId === ALL ? "" : labId, role === ALL ? "" : role, status === ALL ? "" : status);

  return (
    <>
      <title>Users · Platform admin</title>
      <PageHeader
        title="Users"
        description={data ? `${data.length} user${data.length === 1 ? "" : "s"} across all labs` : "Everyone who can sign in to any lab."}
      />
      <div className="flex flex-wrap items-center gap-3">
        <InputGroup className="w-full bg-background sm:w-72">
          <InputGroupInput placeholder="Name, email, mobile or lab" aria-label="Search users" value={search} onChange={(e) => setSearch(e.target.value)} />
        </InputGroup>
        <Select value={labId} onValueChange={setLabId}>
          <SelectTrigger className="w-full sm:w-52 bg-background" aria-label="Lab">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All labs</SelectItem>
            {labs.data?.map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={role} onValueChange={setRole}>
          <SelectTrigger className="w-full sm:w-44 bg-background" aria-label="Role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All roles</SelectItem>
            {SYSTEM_ROLES.map((r) => (
              <SelectItem key={r.key} value={r.key}>
                {r.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-full sm:w-36 bg-background" aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="disabled">Disabled</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <UsersTable users={data} loading={isPending} empty="No users match." />
    </>
  );
}
