"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatTenure, type AdminUserRow } from "@lms/shared";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDateTime } from "@/lib/admin";
import { UserStatusBadge } from "./badges";

export function UsersTable({
  users,
  loading,
  showLab = true,
  empty = "No users.",
}: {
  users: AdminUserRow[] | undefined;
  loading?: boolean;
  showLab?: boolean;
  empty?: string;
}) {
  const router = useRouter();
  const cols = showLab ? 7 : 6;
  return (
    <div className="overflow-x-auto rounded-lg border bg-background">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>User</TableHead>
            {showLab && <TableHead>Lab</TableHead>}
            <TableHead>Roles and access</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>With the lab for</TableHead>
            <TableHead>Last sign-in</TableHead>
            <TableHead className="text-right">Devices</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading && (
            <TableRow>
              <TableCell colSpan={cols}>
                <Skeleton className="h-5 w-full" />
              </TableCell>
            </TableRow>
          )}
          {users?.length === 0 && (
            <TableRow>
              <TableCell colSpan={cols} className="py-10 text-center text-muted-foreground">
                {empty}
              </TableCell>
            </TableRow>
          )}
          {users?.map((u) => (
            <TableRow key={u.id} className="cursor-pointer" onClick={() => router.push(`/admin/users/${u.id}`)}>
              <TableCell>
                <Link href={`/admin/users/${u.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                  {u.name}
                </Link>
                <div className="text-xs text-muted-foreground">{u.email}</div>
              </TableCell>
              {showLab && (
                <TableCell>
                  <Link href={`/admin/labs/${u.lab.id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                    {u.lab.name}
                  </Link>
                  {u.lab.status === "SUSPENDED" && <div className="text-xs text-destructive">Lab suspended</div>}
                </TableCell>
              )}
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {u.roles.map((r) => (
                    <Badge key={`${r.key}-${r.branch}`} variant="secondary">
                      {r.name}
                      {r.branch && <span className="text-muted-foreground">· {r.branch}</span>}
                    </Badge>
                  ))}
                  {u.roles.length === 0 && <span className="text-xs text-muted-foreground">No roles</span>}
                </div>
              </TableCell>
              <TableCell>
                <UserStatusBadge active={u.isActive} />
              </TableCell>
              <TableCell className="whitespace-nowrap">{formatTenure(u.createdAt)}</TableCell>
              <TableCell className="text-sm whitespace-nowrap text-muted-foreground">{u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : "Never"}</TableCell>
              <TableCell className="text-right tabular-nums">{u.activeSessions}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
