"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDownUpIcon, ChevronDownIcon, SearchIcon, UploadIcon } from "lucide-react";
import { ACCOUNT_TYPE_LABEL, paiseToRupees, type AccountListItem } from "@lms/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BulkPriceDialog } from "@/components/b2b/bulk-price-dialog";
import { BulkUploadDialog } from "@/components/b2b/bulk-upload-dialog";
import { LabPriceListDialog } from "@/components/b2b/lab-price-list-dialog";
import { Money } from "@/components/b2b/lab-picker";
import { useAuth } from "@/providers/auth-provider";
import { api } from "@/lib/api";
import { accountKeys, useAccounts } from "@/lib/accounts";
import { downloadCsv } from "@/lib/finance";
import { cn } from "@/lib/utils";

type SortKey = "creditLimitPaise" | "walletPaise" | "holdPaise" | "netPaise";

export default function B2BLabsPage() {
  const { can } = useAuth();
  const write = can("accounts:write");
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const q = useDeferredValue(search.trim());
  const { data, isPending } = useAccounts(q, true);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);
  const router = useRouter();
  const [pricing, setPricing] = useState<AccountListItem | null>(null);
  const [deleting, setDeleting] = useState<AccountListItem | null>(null);
  const [dialog, setDialog] = useState<"bulk-price" | "bulk-upload" | null>(null);

  const rows = useMemo(() => {
    const list = [...(data ?? [])];
    if (sort) list.sort((a, b) => ((a[sort.key] ?? Infinity) - (b[sort.key] ?? Infinity)) * sort.dir);
    return list;
  }, [data, sort]);

  const toggleSort = (key: SortKey) => setSort((s) => (s?.key === key ? (s.dir === 1 ? { key, dir: -1 } : null) : { key, dir: 1 }));
  const sortHead = (key: SortKey, label: string) => (
    <TableHead aria-sort={sort?.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" className="inline-flex items-center gap-1 font-semibold" onClick={() => toggleSort(key)}>
        {label} <ArrowDownUpIcon className="size-3 text-muted-foreground" />
      </button>
    </TableHead>
  );

  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => api(`/accounts/${id}/status`, { method: "POST", body: { isActive } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: accountKeys.all }),
    onError: (err) => toast.error(err.message),
  });

  const rupees = (p: number | null) => (p == null ? "No limit" : paiseToRupees(p));
  const exportLabs = () =>
    downloadCsv(
      "b2b-labs.csv",
      ["Sr No", "Code", "B2B Lab", "Type", "Contact", "Phone", "Email", "Credit Limit", "Discount %", "Wallet Balance", "On Hold", "Net Balance", "Active"],
      rows.map((a, i) => [i + 1, a.code, a.name, ACCOUNT_TYPE_LABEL[a.type], a.contactName ?? "", a.phone ?? "", a.email ?? "", rupees(a.creditLimitPaise), a.discountPercent, paiseToRupees(a.walletPaise), paiseToRupees(a.holdPaise), paiseToRupees(a.netPaise), a.isActive ? "Yes" : "No"]),
    );
  const exportDues = () =>
    downloadCsv(
      "b2b-negative-balances.csv",
      ["Code", "B2B Lab", "Phone", "Wallet Balance", "On Hold", "Net Balance"],
      rows.filter((a) => a.netPaise < 0).map((a) => [a.code, a.name, a.phone ?? "", paiseToRupees(a.walletPaise), paiseToRupees(a.holdPaise), paiseToRupees(a.netPaise)]),
    );

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <InputGroup className="w-full sm:w-96">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput placeholder="Search by B2B Client or Code" aria-label="Search by B2B Client or Code" value={search} onChange={(e) => setSearch(e.target.value)} />
        </InputGroup>
        <div className="flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                Exports <ChevronDownIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={exportLabs}>All labs (CSV)</DropdownMenuItem>
              <DropdownMenuItem onSelect={exportDues}>Labs with negative balance (CSV)</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {write && (
            <>
              <Button variant="outline" className="border-primary text-primary" onClick={() => setDialog("bulk-price")} disabled={!data?.length}>
                Bulk Price Edit
              </Button>
              <Button variant="outline" onClick={() => setDialog("bulk-upload")}>
                <UploadIcon /> Bulk Upload
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="overflow-x-auto border-t">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">Sr. No.</TableHead>
              <TableHead>B2B Lab</TableHead>
              {sortHead("creditLimitPaise", "Credit Limit")}
              {sortHead("walletPaise", "Wallet Balance")}
              {sortHead("holdPaise", "On Hold")}
              {sortHead("netPaise", "Net Balance")}
              <TableHead>Active Status</TableHead>
              <TableHead>Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending && (
              <TableRow>
                <TableCell colSpan={8}>
                  <Skeleton className="h-5 w-full" />
                </TableCell>
              </TableRow>
            )}
            {data?.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                  {q ? "No B2B lab matches." : "No B2B labs yet. Add the labs, hospitals and clinics that send you samples."}
                </TableCell>
              </TableRow>
            )}
            {rows.map((a, i) => (
              <TableRow key={a.id} className={cn(!a.isActive && "opacity-60")}>
                <TableCell>{i + 1}</TableCell>
                <TableCell>
                  <div className="font-medium">{a.name}</div>
                  <div className="text-sm text-muted-foreground">{a.code}</div>
                </TableCell>
                <TableCell className="tabular-nums">{a.creditLimitPaise == null ? <span className="text-muted-foreground">No limit</span> : paiseToRupees(a.creditLimitPaise)}</TableCell>
                <TableCell>
                  <Money plain paise={a.walletPaise} />
                </TableCell>
                <TableCell className="tabular-nums">{paiseToRupees(a.holdPaise)}</TableCell>
                <TableCell>
                  <Money plain paise={a.netPaise} />
                </TableCell>
                <TableCell>
                  <Switch
                    aria-label={`${a.name} active`}
                    checked={a.isActive}
                    disabled={!write || toggle.isPending}
                    onCheckedChange={(v) => toggle.mutate({ id: a.id, isActive: v })}
                  />
                </TableCell>
                <TableCell>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="border-primary text-primary" onClick={() => router.push(`/b2b/lab/${a.id}`)} disabled={!write}>
                      Edit
                    </Button>
                    <Button size="sm" variant="outline" className="border-primary text-primary" onClick={() => setPricing(a)}>
                      Price List
                    </Button>
                    {write && (
                      <Button size="sm" variant="outline" className="border-red-500 text-red-600 hover:text-red-600" onClick={() => setDeleting(a)}>
                        Delete
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {pricing && <LabPriceListDialog lab={pricing} onClose={() => setPricing(null)} />}
      {deleting && <DeleteDialog lab={deleting} onClose={() => setDeleting(null)} />}
      {dialog === "bulk-price" && <BulkPriceDialog labs={data ?? []} onClose={() => setDialog(null)} />}
      {dialog === "bulk-upload" && <BulkUploadDialog onClose={() => setDialog(null)} />}
    </div>
  );
}

function DeleteDialog({ lab, onClose }: { lab: AccountListItem; onClose: () => void }) {
  const queryClient = useQueryClient();
  const del = useMutation({
    mutationFn: () => api(`/accounts/${lab.id}`, { method: "DELETE" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: accountKeys.all });
      toast.success(`${lab.name} deleted`);
      onClose();
    },
    // A lab with orders or wallet history can't be deleted: the message says to switch it off instead.
    onError: (err) => toast.error(err.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete {lab.name}?</DialogTitle>
          <DialogDescription>
            This removes the lab, its portal logins and its price list. A lab that already has orders or wallet history can&apos;t be deleted: switch it off instead.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={del.isPending} onClick={() => del.mutate()}>
            {del.isPending && <Spinner />}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
