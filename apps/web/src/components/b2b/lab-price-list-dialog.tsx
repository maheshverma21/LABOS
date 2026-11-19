"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { DownloadIcon, SearchIcon, UploadIcon } from "lucide-react";
import { paiseToRupees, rupeesToPaise, type AccountListItem, type PriceListDetail } from "@lms/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MoneyInput } from "@/components/inputs/money-input";
import { api } from "@/lib/api";
import { accountKeys } from "@/lib/accounts";
import { catalogKeys, useTests } from "@/lib/catalog";
import { parseCsv } from "@/lib/csv";
import { downloadCsv } from "@/lib/finance";
import { cn } from "@/lib/utils";

const ALL = "all";

/** A B2B lab's own price for every test and package. Rows left at the base price aren't stored. */
export function LabPriceListDialog({ lab, onClose }: { lab: AccountListItem; onClose: () => void }) {
  const tests = useTests();
  const saved = useQuery({
    queryKey: accountKeys.priceList(lab.id),
    queryFn: () => api<{ priceList: PriceListDetail | null }>(`/accounts/${lab.id}/price-list`).then((r) => r.priceList),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Edit Test Price List · {lab.name}</DialogTitle>
        </DialogHeader>
        {!tests.data || saved.data === undefined ? <Skeleton className="h-64 w-full" /> : <Editor lab={lab} tests={tests.data} saved={saved.data} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function Editor({ lab, tests, saved, onClose }: { lab: AccountListItem; tests: NonNullable<ReturnType<typeof useTests>["data"]>; saved: PriceListDetail | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"tests" | "packages">("tests");
  const [search, setSearch] = useState("");
  const [dept, setDept] = useState(ALL);
  const fileRef = useRef<HTMLInputElement>(null);
  /** The lab's price per test; null = back to the base price. */
  const [prices, setPrices] = useState<Map<string, number | null>>(() => new Map(saved?.items.map((i) => [i.testId, i.pricePaise])));

  const departments = useMemo(() => [...new Set(tests.map((t) => t.department.name))].sort(), [tests]);
  const q = search.trim().toLowerCase();
  const shown = tests.filter((t) => t.isPanel === (tab === "packages") && (dept === ALL || t.department.name === dept) && (!q || t.name.toLowerCase().includes(q) || t.code.toLowerCase().includes(q)));
  /** What the lab pays now for a test with no price of its own. */
  const afterDiscount = (base: number) => Math.round((base * (100 - lab.discountPercent)) / 100);

  const download = () =>
    downloadCsv(
      `${lab.code}-price-list.csv`,
      ["Code", "Test Name", "Department", "Type", "Base Price", "Test Price"],
      tests.map((t) => [t.code, t.name, t.department.name, t.isPanel ? "Package" : "Test", paiseToRupees(t.pricePaise), prices.get(t.id) != null ? paiseToRupees(prices.get(t.id)!) : ""]),
    );

  const upload = async (file: File) => {
    const data = parseCsv(await file.text());
    const head = (data[0] ?? []).map((h) => h.trim().toLowerCase());
    const cCode = head.findIndex((h) => h === "code");
    const cPrice = head.findIndex((h) => h === "test price" || h === "price");
    if (cCode < 0 || cPrice < 0) return toast.error("The file needs a Code column and a Test Price column. Download the list for the right layout.");
    const byCode = new Map(tests.map((t) => [t.code.toLowerCase(), t]));
    const next = new Map(prices);
    let applied = 0;
    for (const r of data.slice(1)) {
      const t = byCode.get((r[cCode] ?? "").trim().toLowerCase());
      const raw = (r[cPrice] ?? "").replace(/[₹,\s]/g, "");
      if (!t) continue;
      if (raw === "") next.delete(t.id);
      else if (Number.isFinite(Number(raw)) && Number(raw) >= 0) next.set(t.id, rupeesToPaise(Number(raw)));
      else continue;
      applied++;
    }
    setPrices(next);
    toast.success(`${applied} ${applied === 1 ? "row" : "rows"} read. Save to keep them.`);
  };

  const save = useMutation({
    mutationFn: () => {
      const items = [...prices].filter((e): e is [string, number] => e[1] != null).map(([testId, pricePaise]) => ({ testId, pricePaise }));
      return api(`/accounts/${lab.id}/price-list`, { method: "PUT", body: { items } });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: accountKeys.all });
      await queryClient.invalidateQueries({ queryKey: catalogKeys.priceLists() });
      toast.success("Price list saved");
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <>
      <div className="flex gap-4 border-b text-sm">
        {(["tests", "packages"] as const).map((k) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={cn("-mb-px border-b-2 px-1 pb-2 font-medium", tab === k ? "border-primary text-primary" : "border-transparent text-muted-foreground")}>
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
              <TableHead className="w-32 text-right">Base price</TableHead>
              <TableHead className="w-44">Lab price</TableHead>
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
            {shown.map((t) => (
              <TableRow key={t.id}>
                <TableCell>
                  {t.name} <span className="font-mono text-xs text-muted-foreground">{t.code}</span>
                </TableCell>
                <TableCell>{t.department.name}</TableCell>
                <TableCell className="text-right tabular-nums">₹{paiseToRupees(t.pricePaise)}</TableCell>
                <TableCell>
                  <MoneyInput
                    aria-label={`Price for ${t.name}`}
                    placeholder={lab.discountPercent > 0 ? String(paiseToRupees(afterDiscount(t.pricePaise))) : String(paiseToRupees(t.pricePaise))}
                    value={prices.get(t.id) ?? null}
                    onChange={(p) =>
                      setPrices((prev) => {
                        const next = new Map(prev);
                        if (p == null) next.delete(t.id);
                        else next.set(t.id, p);
                        return next;
                      })
                    }
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        Leave a price blank to use the base price{lab.discountPercent > 0 ? ` less this lab's ${lab.discountPercent}% discount` : ""}. A price set here is used as it is.
      </p>
      <DialogFooter>
        <Button type="button" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending && <Spinner />}
          Save
        </Button>
      </DialogFooter>
    </>
  );
}
