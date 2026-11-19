"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PlusIcon, SearchIcon, XCircleIcon } from "lucide-react";
import type { OutsourceLabItem } from "@lms/shared";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/app-shell/page-header";
import { useAuth } from "@/providers/auth-provider";
import { api } from "@/lib/api";
import { APP_NAME } from "@/lib/brand";
import { outsourceKeys, useOutsourceLabs, useOutsourceTests } from "@/lib/outsourcing";
import { cn } from "@/lib/utils";

const NONE = "__none__";

function useRefresh() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: outsourceKeys.all });
}

/** Adds a lab, or edits one: its name and the tests sent to it. */
function LabDialog({ lab, onClose }: { lab: OutsourceLabItem | null; onClose: () => void }) {
  const { data: tests } = useOutsourceTests();
  const refresh = useRefresh();
  const [name, setName] = useState(lab?.name ?? "");
  const [picked, setPicked] = useState(() => new Set(lab?.tests.map((t) => t.id) ?? []));
  const [q, setQ] = useState("");
  const shown = (tests ?? []).filter((t) => `${t.code} ${t.name}`.toLowerCase().includes(q.trim().toLowerCase()));

  const save = useMutation({
    mutationFn: () =>
      lab
        ? api(`/outsourcing/labs/${lab.id}`, { method: "PUT", body: { name: name.trim(), testIds: [...picked] } })
        : api("/outsourcing/labs", { method: "POST", body: { name: name.trim(), testIds: [...picked] } }),
    onSuccess: async () => {
      await refresh();
      toast.success(lab ? "Saved" : "Lab added");
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-4 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{lab ? `Edit ${lab.name}` : "Add Lab"}</DialogTitle>
          <DialogDescription>Enter the lab&apos;s name and tick the tests that are sent to it. A test can go to one lab at a time.</DialogDescription>
        </DialogHeader>
        <Input aria-label="Lab name" placeholder="Lab name" autoFocus maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        <Input aria-label="Search tests" placeholder="Search tests" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border">
          {!tests ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            shown.map((t) => {
              const elsewhere = t.labId && t.labId !== lab?.id && !picked.has(t.id);
              return (
                <label key={t.id} className="flex cursor-pointer items-center gap-3 border-b px-3 py-2 text-sm last:border-0">
                  <Checkbox
                    checked={picked.has(t.id)}
                    onCheckedChange={(v) =>
                      setPicked((s) => {
                        const n = new Set(s);
                        if (v === true) n.add(t.id);
                        else n.delete(t.id);
                        return n;
                      })
                    }
                  />
                  <span className="font-mono text-xs text-muted-foreground">{t.code}</span>
                  <span className="flex-1">{t.name}</span>
                  {elsewhere && <span className="text-xs text-muted-foreground">at another lab</span>}
                </label>
              );
            })
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={name.trim().length < 2 || save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Spinner />}
            {lab ? "Save" : "Add Lab"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LabWise({ canWrite }: { canWrite: boolean }) {
  const { data: labs, isPending } = useOutsourceLabs();
  const refresh = useRefresh();
  const [q, setQ] = useState("");
  const [dialog, setDialog] = useState<{ lab: OutsourceLabItem | null; n: number } | null>(null);
  const [deleting, setDeleting] = useState<OutsourceLabItem | null>(null);

  const remove = useMutation({
    mutationFn: (id: string) => api(`/outsourcing/labs/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      await refresh();
      toast.success("Lab deleted");
      setDeleting(null);
    },
    onError: (err) => toast.error(err.message),
  });
  const shown = (labs ?? []).filter((l) => l.name.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="space-y-4">
      {canWrite && (
        <div className="flex justify-end">
          <Button onClick={() => setDialog({ lab: null, n: Date.now() })}>
            <PlusIcon /> Add Lab
          </Button>
        </div>
      )}
      <Card className="gap-4 p-4">
        <div className="relative max-w-xs">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search by Lab Name" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">Sr. No.</TableHead>
                <TableHead>Lab Name</TableHead>
                <TableHead>Total No. of Tests</TableHead>
                <TableHead className="w-48">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((l, i) => (
                <TableRow key={l.id}>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell className="font-medium">{l.name}</TableCell>
                  <TableCell>{l.testCount}</TableCell>
                  <TableCell>
                    {canWrite && (
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" className="text-primary" onClick={() => setDialog({ lab: l, n: Date.now() })}>
                          Edit
                        </Button>
                        <Button variant="outline" size="sm" className="text-destructive" onClick={() => setDeleting(l)}>
                          <XCircleIcon /> Delete
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {shown.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                    {labs?.length ? "No lab matches." : "No outsource labs yet. Click Add Lab to add one."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </Card>

      {dialog && <LabDialog key={dialog.n} lab={dialog.lab} onClose={() => setDialog(null)} />}
      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete {deleting?.name}?</DialogTitle>
            <DialogDescription>
              Its {deleting?.testCount ?? 0} tests go back to being done in your own lab. Reports already uploaded are kept.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Keep lab
            </Button>
            <Button variant="destructive" disabled={remove.isPending} onClick={() => deleting && remove.mutate(deleting.id)}>
              {remove.isPending && <Spinner />}
              Delete lab
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TestWise({ canWrite }: { canWrite: boolean }) {
  const { data: tests, isPending } = useOutsourceTests();
  const { data: labs } = useOutsourceLabs();
  const refresh = useRefresh();
  const [q, setQ] = useState("");
  const [onlyOutsourced, setOnlyOutsourced] = useState(false);

  const setLab = useMutation({
    mutationFn: (v: { id: string; labId: string | null }) => api(`/outsourcing/tests/${v.id}`, { method: "PUT", body: { labId: v.labId } }),
    onSuccess: refresh,
    onError: (err) => toast.error(err.message),
  });

  const shown = (tests ?? []).filter(
    (t) => `${t.code} ${t.name}`.toLowerCase().includes(q.trim().toLowerCase()) && (!onlyOutsourced || t.labId),
  );

  return (
    <Card className="gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-xs">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search by Test Name or Code" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox checked={onlyOutsourced} onCheckedChange={(v) => setOnlyOutsourced(v === true)} />
          Only outsourced tests
        </label>
      </div>
      {isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">Sr. No.</TableHead>
              <TableHead>Test</TableHead>
              <TableHead>Department</TableHead>
              <TableHead className="w-72">Outsource Lab</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((t, i) => (
              <TableRow key={t.id}>
                <TableCell>{i + 1}</TableCell>
                <TableCell>
                  <span className="font-mono text-xs text-muted-foreground">{t.code}</span> {t.name}
                </TableCell>
                <TableCell className="text-muted-foreground">{t.department}</TableCell>
                <TableCell>
                  <Select
                    value={t.labId ?? NONE}
                    disabled={!canWrite || setLab.isPending}
                    onValueChange={(v) => setLab.mutate({ id: t.id, labId: v === NONE ? null : v })}
                  >
                    <SelectTrigger className={cn("w-full", !t.labId && "text-muted-foreground")} aria-label={`Outsource lab for ${t.name}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Done in our lab</SelectItem>
                      {(labs ?? []).map((l) => (
                        <SelectItem key={l.id} value={l.id}>
                          {l.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
              </TableRow>
            ))}
            {shown.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                  No tests found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

const TABS = [
  { id: "test", label: "Test wise" },
  { id: "lab", label: "Lab wise" },
] as const;

export default function OutsourcingPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("lab");
  const canWrite = can("catalog:write");
  return (
    <>
      <title>{`Outsourcing Management · ${APP_NAME}`}</title>
      <PageHeader title="Outsourcing Management" description="Tests that are sent to another lab. Their results can be typed in or uploaded as the lab's report." />
      <div role="tablist" className="flex gap-6 border-b">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "-mb-px border-b-2 pb-2 text-sm font-medium transition-colors",
              tab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "lab" ? <LabWise canWrite={canWrite} /> : <TestWise canWrite={canWrite} />}
    </>
  );
}
