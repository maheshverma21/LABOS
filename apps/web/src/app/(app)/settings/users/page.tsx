"use client";

import { useQuery } from "@tanstack/react-query";
import type { UserListItem } from "@lms/shared";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/app-shell/page-header";
import { useAuth } from "@/providers/auth-provider";
import { api } from "@/lib/api";
import { AddUserDialog } from "./add-user-dialog";
import { UserActions } from "./user-actions";

const dateFormat = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });

export default function UsersPage() {
  const { can } = useAuth();
  const { data, isPending, error } = useQuery({
    queryKey: ["users"],
    queryFn: () => api<{ users: UserListItem[] }>("/users"),
    enabled: can("users:read"),
  });

  if (!can("users:read")) {
    return <PageHeader title="Users & roles" description="You don't have permission to view users." />;
  }

  return (
    <>
      <PageHeader
        title="Users & roles"
        description="Everyone who can sign in to your lab, and what they can do."
        actions={can("users:write") && <AddUserDialog />}
      />

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Roles</TableHead>
              <TableHead className="hidden md:table-cell">Phone</TableHead>
              <TableHead className="hidden lg:table-cell">Last sign-in</TableHead>
              <TableHead className="text-right">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending &&
              Array.from({ length: 3 }, (_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={5}>
                    <Skeleton className="h-5 w-full" />
                  </TableCell>
                </TableRow>
              ))}
            {error && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-sm text-destructive">
                  {error.message}
                </TableCell>
              </TableRow>
            )}
            {data?.users.map((u) => (
              <TableRow key={u.id}>
                <TableCell>
                  <div className="font-medium">{u.name}</div>
                  <div className="text-xs text-muted-foreground">{u.email}</div>
                  {u.qualification && <div className="text-xs text-muted-foreground">{u.qualification}</div>}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {u.roles.map((r) => (
                      <Badge key={`${r.key}-${r.branch}`} variant="secondary">
                        {r.name}
                        {r.branch && <span className="text-muted-foreground">· {r.branch}</span>}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="hidden md:table-cell">{u.phone ?? "—"}</TableCell>
                <TableCell className="hidden lg:table-cell text-muted-foreground">
                  {u.lastLoginAt ? dateFormat.format(new Date(u.lastLoginAt)) : "Never"}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    {u.mustChangePassword && u.isActive && (
                      <Badge variant="outline" title="Signs in with a temporary password and must choose their own">
                        New password due
                      </Badge>
                    )}
                    <Badge variant={u.isActive ? "outline" : "destructive"}>{u.isActive ? "Active" : "Disabled"}</Badge>
                    {can("users:write") && <UserActions user={u} />}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
