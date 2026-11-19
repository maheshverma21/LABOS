"use client";

import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { LogInIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { formatTenure, type AdminLabRow } from "@lms/shared";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ApiError } from "@/lib/api";
import { adminApi } from "@/lib/admin-api";
import { useAdminAuth } from "@/providers/admin-auth-provider";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate, fmtDateTime } from "@/lib/admin";
import { LabStatusBadge, PlanBadge, RenewsOn } from "./badges";

export function LabsTable({ labs, loading, empty = "No labs." }: { labs: AdminLabRow[] | undefined; loading?: boolean; empty?: string }) {
  const router = useRouter();
  const { isSuper } = useAdminAuth();
  // Open the tab straight away (a popup opened after an await gets blocked), then point it at the lab.
  const loginAs = useMutation({
    mutationFn: async ({ id }: { id: string; tab: Window | null }) => (await adminApi<{ ticket: string }>(`/labs/${id}/login`, { method: "POST" })).ticket,
    onSuccess: (ticket, { tab }) => {
      const url = `/lab-login?ticket=${encodeURIComponent(ticket)}`;
      if (tab) tab.location.href = url;
      else window.location.assign(url);
    },
    onError: (err, { tab }) => {
      tab?.close();
      toast.error(err instanceof ApiError ? err.message : "Couldn't sign in to the lab");
    },
  });
  return (
    <div className="overflow-x-auto rounded-lg border bg-background">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Lab</TableHead>
            <TableHead>Plan</TableHead>
            <TableHead>Subscription</TableHead>
            <TableHead className="text-right">Users</TableHead>
            <TableHead className="text-right">Orders (30 d)</TableHead>
            <TableHead>Customer for</TableHead>
            <TableHead>Last active</TableHead>
            {isSuper && <TableHead className="text-right">Access</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading && (
            <TableRow>
              <TableCell colSpan={isSuper ? 8 : 7}>
                <Skeleton className="h-5 w-full" />
              </TableCell>
            </TableRow>
          )}
          {labs?.length === 0 && (
            <TableRow>
              <TableCell colSpan={isSuper ? 8 : 7} className="py-10 text-center text-muted-foreground">
                {empty}
              </TableCell>
            </TableRow>
          )}
          {labs?.map((l) => (
            <TableRow key={l.id} className="cursor-pointer" onClick={() => router.push(`/admin/labs/${l.id}`)}>
              <TableCell>
                <Link href={`/admin/labs/${l.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                  {l.name}
                </Link>
                <div className="text-xs text-muted-foreground">{l.owner ? `${l.owner.name} · ${l.owner.email}` : "No owner"}</div>
              </TableCell>
              <TableCell>
                <PlanBadge plan={l.plan} />
              </TableCell>
              <TableCell>
                <div className="flex flex-col gap-1">
                  <LabStatusBadge status={l.status} />
                  {l.status !== "SUSPENDED" && <RenewsOn iso={l.planRenewsAt} className="text-xs" />}
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {l.activeUsers}
                {l.activeUsers !== l.users && <span className="text-muted-foreground"> / {l.users}</span>}
              </TableCell>
              <TableCell className="text-right tabular-nums">{l.orders30d}</TableCell>
              <TableCell>
                {formatTenure(l.createdAt)}
                <div className="text-xs text-muted-foreground">since {fmtDate(l.createdAt)}</div>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">{l.lastActivityAt ? fmtDateTime(l.lastActivityAt) : "Never"}</TableCell>
              {isSuper && (
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={l.status === "SUSPENDED" || !l.owner || (loginAs.isPending && loginAs.variables?.id === l.id)}
                    title={l.status === "SUSPENDED" ? "This lab is suspended" : !l.owner ? "This lab has no owner" : "Open this lab's app, signed in as its owner"}
                    onClick={(e) => {
                      e.stopPropagation();
                      loginAs.mutate({ id: l.id, tab: window.open("about:blank", "_blank") });
                    }}
                  >
                    {loginAs.isPending && loginAs.variables?.id === l.id ? <Spinner /> : <LogInIcon />} Login
                  </Button>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
