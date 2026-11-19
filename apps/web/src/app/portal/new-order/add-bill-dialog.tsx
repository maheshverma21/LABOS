"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PlusIcon, SearchIcon, Trash2Icon } from "lucide-react";
import { ageOn, formatAge, formatINR, SEX_LABEL, todayIST, type PatientListItem, type PortalOrderItem } from "@lms/shared";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Money } from "@/components/b2b/lab-picker";
import { api } from "@/lib/api";
import { portalKeys, usePortalCatalog, usePortalSummary } from "@/lib/portal";

export type BillAction = "barcode" | "bill";

/** Add the tests to a registered patient's order. Shows the lab's standard rate next to this client's own price. */
export function AddBillDialog({
  patient,
  barcode,
  onClose,
  onPlaced,
}: {
  patient: PatientListItem;
  barcode: string | null;
  onClose: () => void;
  onPlaced: (order: PortalOrderItem, action: BillAction) => void;
}) {
  const queryClient = useQueryClient();
  const catalog = usePortalCatalog();
  const summary = usePortalSummary();
  const [picked, setPicked] = useState<string[]>([]);
  const [urgent, setUrgent] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<"tests" | "packages">("tests");
  const [focused, setFocused] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");

  const byId = useMemo(() => new Map((catalog.data ?? []).map((t) => [t.id, t])), [catalog.data]);
  const q = search.trim().toLowerCase();
  const matches = (catalog.data ?? []).filter((t) => t.isPanel === (kind === "packages") && !picked.includes(t.id) && (!q || t.name.toLowerCase().includes(q) || t.code.toLowerCase().includes(q))).slice(0, 30);
  const total = picked.reduce((t, id) => t + (byId.get(id)?.pricePaise ?? 0), 0);
  const available = summary.data?.availablePaise ?? null;
  const overLimit = available != null && total > available;
  const hideRate = summary.data?.features.hideB2bRateFromBilling === true;
  const allUrgent = picked.length > 0 && picked.every((id) => urgent.has(id));

  const place = useMutation({
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    mutationFn: (_action: BillAction) =>
      api<{ order: PortalOrderItem }>("/b2b/orders", {
        method: "POST",
        body: { patientId: patient.id, testIds: picked, urgentTestIds: [...urgent], barcode, notes: note },
      }),
    onSuccess: async ({ order }, action) => {
      await queryClient.invalidateQueries({ queryKey: portalKeys.all });
      await queryClient.invalidateQueries({ queryKey: ["accounts"] });
      toast.success(`Order ${order.orderNo} placed`);
      onPlaced(order, action);
    },
    onError: (err) => toast.error(err.message),
  });
  const busy = place.isPending;

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="flex h-[85vh] flex-col gap-0 p-0 sm:max-w-5xl" showCloseButton>
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>Add Bill</DialogTitle>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 md:grid-cols-[18rem_1fr]">
          <aside className="space-y-4 overflow-auto border-r p-5 text-sm">
            <div className="text-muted-foreground underline">Patient Details</div>
            <div>
              <div className="font-semibold">{patient.name}</div>
              <div className="mt-1 text-base">{patient.uhid}</div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-muted-foreground">Gender</div>
                <div className="lowercase">{SEX_LABEL[patient.sex]}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Age</div>
                <div>{formatAge(ageOn(patient.dob, todayIST()))}</div>
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Contact Number</div>
              <div>{patient.phone ?? "—"}</div>
            </div>
            {noteOpen ? (
              <textarea
                aria-label="Note on bill"
                autoFocus
                maxLength={300}
                placeholder="Note for the lab"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="min-h-24 w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            ) : (
              <Button variant="outline" className="w-full" onClick={() => setNoteOpen(true)}>
                <PlusIcon /> Add Note on Bill
              </Button>
            )}
          </aside>

          <section className="flex min-h-0 flex-col">
            <div className="min-h-0 flex-1 overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-card">
                  <TableRow>
                    <TableHead className="w-16">Sr No.</TableHead>
                    <TableHead>Test / Package</TableHead>
                    <TableHead>MRP</TableHead>
                    {!hideRate && <TableHead>B2B Price</TableHead>}
                    <TableHead>
                      <label className="flex items-center gap-2">
                        <Checkbox aria-label="All urgent" checked={allUrgent} disabled={picked.length === 0} onCheckedChange={(v) => setUrgent(v === true ? new Set(picked) : new Set())} /> Urgent
                      </label>
                    </TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {picked.map((id, i) => {
                    const t = byId.get(id);
                    return (
                      <TableRow key={id}>
                        <TableCell>{i + 1}</TableCell>
                        <TableCell className="uppercase">{t?.name}</TableCell>
                        <TableCell className="tabular-nums">₹ {(t?.mrpPaise ?? 0) / 100}</TableCell>
                        {!hideRate && <TableCell className="tabular-nums">₹ {(t?.pricePaise ?? 0) / 100}</TableCell>}
                        <TableCell>
                          <Checkbox
                            aria-label={`${t?.name} urgent`}
                            checked={urgent.has(id)}
                            onCheckedChange={(v) =>
                              setUrgent((u) => {
                                const n = new Set(u);
                                if (v === true) n.add(id);
                                else n.delete(id);
                                return n;
                              })
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Button size="sm" variant="outline" className="border-red-500 text-red-600 hover:text-red-600" onClick={() => setPicked((p) => p.filter((x) => x !== id))}>
                            <Trash2Icon /> Delete
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  <TableRow className="hover:bg-transparent">
                    <TableCell />
                    <TableCell colSpan={5}>
                      <div className="flex items-start gap-2">
                        <div className="relative flex-1">
                          <SearchIcon className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
                          <input
                            autoFocus
                            aria-label="Search by test name or test code"
                            placeholder="Search by test name or test code"
                            value={search}
                            onFocus={() => setFocused(true)}
                            onBlur={() => setTimeout(() => setFocused(false), 150)}
                            onChange={(e) => setSearch(e.target.value)}
                            className="h-9 w-full rounded-md border bg-transparent pr-3 pl-9 text-sm outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring/50"
                          />
                          {focused && (
                            <ul className="mt-1 max-h-56 w-full overflow-auto rounded-md border bg-popover shadow-md">
                              {catalog.isPending && <li className="p-3 text-sm text-muted-foreground">Loading…</li>}
                              {!catalog.isPending && matches.length === 0 && <li className="p-3 text-sm text-muted-foreground">Nothing matches.</li>}
                              {matches.map((t) => (
                                <li key={t.id}>
                                  <button
                                    type="button"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => {
                                      setPicked((p) => [...p, t.id]);
                                      setSearch("");
                                    }}
                                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted"
                                  >
                                    <span className="truncate">
                                      {t.name} <span className="font-mono text-xs text-muted-foreground">{t.code}</span>
                                    </span>
                                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                                      MRP ₹{t.mrpPaise / 100}{!hideRate && <> · <span className="font-medium text-foreground">B2B ₹{t.pricePaise / 100}</span></>}
                                    </span>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                        <Select value={kind} onValueChange={(v) => setKind(v as "tests" | "packages")}>
                          <SelectTrigger className="w-32" aria-label="Tests or packages">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="tests">Tests</SelectItem>
                            <SelectItem value="packages">Packages</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t px-6 py-4">
              <div className="text-sm">
                <div className="font-semibold">Total {formatINR(total)}</div>
                {summary.data && (
                  <div className={overLimit ? "text-destructive" : "text-muted-foreground"}>
                    Net balance <Money paise={summary.data.account.netPaise} />
                    {available != null && <> · available {formatINR(Math.max(available, 0))}</>}
                    {overLimit && " · add money to your wallet first"}
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="border-primary text-primary" disabled={picked.length === 0 || overLimit || busy} onClick={() => place.mutate("barcode")}>
                  {busy && place.variables === "barcode" && <Spinner />}
                  Register &amp; Add Barcode
                </Button>
                <Button disabled={picked.length === 0 || overLimit || busy} onClick={() => place.mutate("bill")}>
                  {busy && place.variables === "bill" && <Spinner />}
                  Register and Print Bill
                </Button>
              </div>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
