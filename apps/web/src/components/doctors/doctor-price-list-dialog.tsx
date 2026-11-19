"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { DownloadIcon, SearchIcon, UploadIcon } from "lucide-react";
import { paiseToRupees, rupeesToPaise, type CommissionMode, type DoctorItem, type PriceListDetail } from "@lms/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MoneyInput } from "@/components/inputs/money-input";
import { api } from "@/lib/api";
import { catalogKeys, usePriceLists, useTests } from "@/lib/catalog";
import { cn } from "@/lib/utils";

interface Row {
  /** Rupees-as-paise; null = back to the base price. */
  price: number | null;
  pct: number | null;
  amt: number | null;
}

const ALL = "all";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Keeps commission % and commission ₹ in step: the one the user works in (mode) is the source, the other is worked out from the price. */
function syncCommission(price: number, pct: number | null, amt: number | null, mode: CommissionMode): { pct: number | null; amt: number | null } {
  if (mode === "PERCENT") return { pct, amt: pct == null ? null : Math.round((price * pct) / 100) };
  if (amt == null) return { pct: null, amt: null };
  return { pct: price > 0 ? Math.min(100, round2((amt * 100) / price)) : pct, amt };
}

const csvCell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

/** Price and commission for every test and package, for one referring doctor. */
export function DoctorPriceListDialog({ doctor, open, onOpenChange }: { doctor: DoctorItem; open: boolean; onOpenChange: (o: boolean) => void }) {
  const queryClient = useQueryClient();
  const tests = useTests();
  const lists = usePriceLists();
  const saved = useQuery({
    queryKey: ["doctors", doctor.id, "price-list"],
    queryFn: () => api<{ priceList: PriceListDetail | null }>(`/doctors/${doctor.id}/price-list`).then((r) => r.priceList),
    enabled: open,
  });
  const ready = !!tests.data && saved.data !== undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Edit Test Price List · {doctor.name}</DialogTitle>
        </DialogHeader>
        {!ready ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <Editor
            doctor={doctor}
            tests={tests.data!}
            saved={saved.data ?? null}
            otherLists={lists.data?.filter((l) => l.id !== saved.data?.id) ?? []}
            onSaved={async () => {
              await queryClient.invalidateQueries({ queryKey: ["doctors"] });
              await queryClient.invalidateQueries({ queryKey: catalogKeys.priceLists() });
              toast.success("Price list saved");
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Editor({
  doctor,
  tests,
  saved,
  otherLists,
  onSaved,
}: {
  doctor: DoctorItem;
  tests: NonNullable<ReturnType<typeof useTests>["data"]>;
  saved: PriceListDetail | null;
  otherLists: { id: string; name: string }[];
  onSaved: () => void | Promise<void>;
}) {
  const [mode, setMode] = useState<CommissionMode>(saved?.commissionMode ?? "PERCENT");
  const [tab, setTab] = useState<"tests" | "packages">("tests");
  const [search, setSearch] = useState("");
  const [dept, setDept] = useState(ALL);
  const fileRef = useRef<HTMLInputElement>(null);

  // Start from what's saved; a first-time list starts at base prices and the doctor's usual commission.
  const [rows, setRows] = useState<Map<string, Row>>(() => {
    const m = new Map<string, Row>();
    const items = new Map(saved?.items.map((i) => [i.testId, i]));
    for (const t of tests) {
      const i = items.get(t.id);
      const price = i ? i.pricePaise : t.pricePaise || null;
      const startMode = saved?.commissionMode ?? "PERCENT";
      m.set(t.id, {
        price,
        ...syncCommission(price ?? 0, i ? i.commissionPercent : saved ? null : doctor.commissionPercent || null, i?.commissionPaise ?? null, startMode),
      });
    }
    return m;
  });
  const baseOf = (id: string) => tests.find((x) => x.id === id)?.pricePaise ?? 0;
  /** Change one field of a row; commission % and ₹ follow each other, and both follow the price. */
  const edit = (id: string, patch: Partial<Row>, source: CommissionMode = mode) =>
    setRows((prev) => {
      const cur = { ...prev.get(id)!, ...patch };
      return new Map(prev).set(id, { ...cur, ...syncCommission(cur.price ?? baseOf(id), cur.pct, cur.amt, source) });
    });

  const departments = useMemo(() => [...new Set(tests.map((t) => t.department.name))].sort(), [tests]);
  const q = search.trim().toLowerCase();
  const shown = tests.filter(
    (t) =>
      t.isPanel === (tab === "packages") &&
      (dept === ALL || t.department.name === dept) &&
      (!q || t.name.toLowerCase().includes(q) || t.code.toLowerCase().includes(q)),
  );

  const copyFrom = async (listId: string) => {
    try {
      const { priceList } = await api<{ priceList: PriceListDetail }>(`/catalog/price-lists/${listId}`);
      const items = new Map(priceList.items.map((i) => [i.testId, i]));
      setRows((prev) => {
        const next = new Map(prev);
        for (const t of tests) {
          const i = items.get(t.id);
          const price = i?.pricePaise ?? (t.pricePaise || null);
          next.set(t.id, { price, ...syncCommission(price ?? 0, i?.commissionPercent ?? prev.get(t.id)!.pct, i?.commissionPaise ?? prev.get(t.id)!.amt, mode) });
        }
        return next;
      });
      toast.success(`Copied from ${priceList.name}. Save to keep it.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't copy");
    }
  };

  const download = () => {
    const header = ["Code", "Test Name", "Department", "Type", "Test Price", mode === "PERCENT" ? "Commission Percentage" : "Commission Price"];
    const lines = [header.map(csvCell).join(",")];
    for (const t of tests) {
      const r = rows.get(t.id)!;
      lines.push(
        [t.code, t.name, t.department.name, t.isPanel ? "Package" : "Test", r.price == null ? "" : paiseToRupees(r.price), mode === "PERCENT" ? (r.pct ?? "") : r.amt == null ? "" : paiseToRupees(r.amt)]
          .map(csvCell)
          .join(","),
      );
    }
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${doctor.name.replace(/[^\w]+/g, "-")}-price-list.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const upload = async (file: File) => {
    const data = parseCsv(await file.text());
    const head = (data[0] ?? []).map((h) => h.trim().toLowerCase());
    const col = (re: RegExp) => head.findIndex((h) => re.test(h));
    const cCode = col(/^code$/);
    const cPrice = col(/price/);
    const cComm = col(/commission/);
    if (cCode < 0 || cPrice < 0) return toast.error("The file needs a Code column and a Test Price column. Download the list for the right layout.");
    const byCode = new Map(tests.map((t) => [t.code.toLowerCase(), t]));
    let applied = 0;
    const next = new Map(rows);
    for (const r of data.slice(1)) {
      const t = byCode.get((r[cCode] ?? "").trim().toLowerCase());
      if (!t) continue;
      const price = Number((r[cPrice] ?? "").replace(/[₹,\s]/g, ""));
      const comm = cComm >= 0 ? Number((r[cComm] ?? "").replace(/[₹,%\s]/g, "")) : NaN;
      const cur = next.get(t.id)!;
      const newPrice = Number.isFinite(price) && (r[cPrice] ?? "").trim() !== "" ? rupeesToPaise(price) : cur.price;
      const hasComm = Number.isFinite(comm) && (r[cComm] ?? "").trim() !== "";
      next.set(t.id, {
        price: newPrice,
        ...syncCommission(
          newPrice ?? t.pricePaise,
          mode === "PERCENT" && hasComm ? Math.min(comm, 100) : cur.pct,
          mode === "AMOUNT" && hasComm ? rupeesToPaise(comm) : cur.amt,
          mode,
        ),
      });
      applied++;
    }
    setRows(next);
    toast.success(`${applied} ${applied === 1 ? "row" : "rows"} read. Save to keep them.`);
  };

  const save = useMutation({
    mutationFn: () => {
      const items = tests
        .map((t) => ({ t, r: rows.get(t.id)! }))
        // Only rows that say something: a price other than the base, or a commission.
        .filter(({ t, r }) => (r.price != null && r.price !== t.pricePaise) || r.pct != null || r.amt != null)
        .map(({ t, r }) => ({ testId: t.id, pricePaise: r.price ?? t.pricePaise, commissionPercent: r.pct, commissionPaise: r.amt }));
      return api(`/doctors/${doctor.id}/price-list`, { method: "PUT", body: { commissionMode: mode, items } });
    },
    onSuccess: onSaved,
    onError: (err) => toast.error(err.message),
  });

  return (
    <>
      <div className="flex gap-4 border-b text-sm">
        {(["tests", "packages"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={cn("-mb-px border-b-2 px-1 pb-2 font-medium", tab === k ? "border-primary text-primary" : "border-transparent text-muted-foreground")}
          >
            {k === "tests" ? "Test list" : "Package List"}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <InputGroup className="w-full sm:w-48">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput placeholder="Search by name" aria-label="Search by name" value={search} onChange={(e) => setSearch(e.target.value)} />
        </InputGroup>
        <Select value={dept} onValueChange={setDept}>
          <SelectTrigger className="w-full sm:w-48" aria-label="Department">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All departments</SelectItem>
            {departments.map((d) => (
              <SelectItem key={d} value={d}>
                {d}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value="" onValueChange={(v) => void copyFrom(v)}>
          <SelectTrigger className="w-full sm:w-44" aria-label="Copy from">
            <SelectValue placeholder="Copy from" />
          </SelectTrigger>
          <SelectContent>
            {otherLists.map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="button" variant="outline" onClick={download}>
          <DownloadIcon /> Download List
        </Button>
        <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
          <UploadIcon /> Upload List
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void upload(f);
          }}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
        <Table>
          <TableHeader className="sticky top-0 bg-background">
            <TableRow>
              <TableHead>{tab === "tests" ? "Test Name" : "Package Name"}</TableHead>
              <TableHead>Department</TableHead>
              <TableHead className="w-40">{tab === "tests" ? "Test Price" : "Package Price"}</TableHead>
              <TableHead className="w-48">{mode === "PERCENT" ? "Commission Percentage(%)" : "Commission Price (₹)"}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                  Nothing matches.
                </TableCell>
              </TableRow>
            )}
            {shown.map((t) => {
              const r = rows.get(t.id)!;
              return (
                <TableRow key={t.id}>
                  <TableCell>
                    {t.name} <span className="font-mono text-xs text-muted-foreground">{t.code}</span>
                  </TableCell>
                  <TableCell>{t.department.name}</TableCell>
                  <TableCell>
                    <MoneyInput
                      aria-label={`Price for ${t.name}`}
                      value={r.price ?? (t.pricePaise || null)}
                      onChange={(p) => edit(t.id, { price: p })}
                    />
                  </TableCell>
                  <TableCell>
                    {mode === "PERCENT" ? (
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          max={100}
                          step="0.01"
                          aria-label={`Commission % for ${t.name}`}
                          value={r.pct ?? ""}
                          onChange={(e) => edit(t.id, { pct: e.target.value === "" ? null : Math.min(100, Math.max(0, Number(e.target.value))) }, "PERCENT")}
                        />
                        <span className="text-muted-foreground">%</span>
                      </div>
                    ) : (
                      <MoneyInput aria-label={`Commission amount for ${t.name}`} value={r.amt} onChange={(p) => edit(t.id, { amt: p }, "AMOUNT")} />
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        Base prices are used for tests left unchanged. Commission is worked out on what the patient pays for each test after any discount; tests with no commission here use {doctor.commissionPercent}% (the doctor&apos;s usual rate).
      </p>

      <DialogFooter className="items-center sm:justify-between">
        <div className="flex items-center gap-5">
          {(["PERCENT", "AMOUNT"] as const).map((m) => (
            <Label key={m} className="gap-2 font-normal">
              <input type="radio" name="commission-mode" checked={mode === m} onChange={() => setMode(m)} className="accent-primary" />
              {m === "PERCENT" ? "Commission Percentage" : "Commission Price"}
            </Label>
          ))}
        </div>
        <Button type="button" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending && <Spinner />}
          Save
        </Button>
      </DialogFooter>
    </>
  );
}
