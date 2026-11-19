"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SearchIcon } from "lucide-react";
import { paiseToRupees, type AccountListItem } from "@lms/shared";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { MoneyInput } from "@/components/inputs/money-input";
import { NumberInput } from "@/components/inputs/number-input";
import { api } from "@/lib/api";
import { accountKeys } from "@/lib/accounts";
import { catalogKeys, useTests } from "@/lib/catalog";
import { cn } from "@/lib/utils";

/** One price change applied to the chosen labs' own price lists. */
export function BulkPriceDialog({ labs, onClose }: { labs: AccountListItem[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const tests = useTests();
  const [mode, setMode] = useState<"FIXED" | "PERCENT">("PERCENT");
  const [picked, setPicked] = useState<Set<string>>(() => new Set(labs.map((l) => l.id)));
  const [testIds, setTestIds] = useState<Set<string>>(new Set());
  const [fixed, setFixed] = useState<Map<string, number | null>>(new Map());
  const [percent, setPercent] = useState<number | null>(-10);
  const [search, setSearch] = useState("");

  const q = search.trim().toLowerCase();
  const shown = useMemo(() => (tests.data ?? []).filter((t) => !q || t.name.toLowerCase().includes(q) || t.code.toLowerCase().includes(q)), [tests.data, q]);
  const toggle = <T,>(set: Set<T>, v: T, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(v);
    else next.delete(v);
    return next;
  };

  const fixedItems = [...fixed].filter((e): e is [string, number] => e[1] != null).map(([testId, pricePaise]) => ({ testId, pricePaise }));
  const ready = picked.size > 0 && (mode === "FIXED" ? fixedItems.length > 0 : percent != null && percent >= -100);

  const apply = useMutation({
    mutationFn: () =>
      api<{ labs: number; tests: number }>("/accounts/bulk-price", {
        method: "POST",
        body: mode === "FIXED" ? { mode, accountIds: [...picked], items: fixedItems } : { mode, accountIds: [...picked], percent, testIds: [...testIds] },
      }),
    onSuccess: async (r) => {
      await queryClient.invalidateQueries({ queryKey: accountKeys.all });
      await queryClient.invalidateQueries({ queryKey: catalogKeys.priceLists() });
      toast.success(`${r.tests} ${r.tests === 1 ? "price" : "prices"} set for ${r.labs} ${r.labs === 1 ? "lab" : "labs"}`);
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Bulk price edit</DialogTitle>
          <DialogDescription>Change prices for several labs at once. Each lab keeps its other prices.</DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 gap-4 overflow-hidden sm:grid-cols-[14rem_1fr]">
          <div className="flex min-h-0 flex-col gap-2">
            <div className="flex items-center justify-between text-sm font-medium">
              Labs ({picked.size})
              <button type="button" className="text-xs font-normal text-primary" onClick={() => setPicked(picked.size === labs.length ? new Set() : new Set(labs.map((l) => l.id)))}>
                {picked.size === labs.length ? "Clear" : "All"}
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-1 overflow-auto rounded-lg border p-2">
              {labs.map((l) => (
                <Label key={l.id} className="gap-2 font-normal">
                  <Checkbox checked={picked.has(l.id)} onCheckedChange={(v) => setPicked(toggle(picked, l.id, v === true))} />
                  <span className="truncate">{l.name}</span>
                </Label>
              ))}
            </div>
          </div>
          <div className="flex min-h-0 flex-col gap-3">
            <div className="flex gap-4 border-b text-sm">
              {(["PERCENT", "FIXED"] as const).map((m) => (
                <button key={m} type="button" onClick={() => setMode(m)} className={cn("-mb-px border-b-2 px-1 pb-2 font-medium", mode === m ? "border-primary text-primary" : "border-transparent text-muted-foreground")}>
                  {m === "PERCENT" ? "By percentage" : "Fixed prices"}
                </button>
              ))}
            </div>
            {mode === "PERCENT" && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                Change base price by
                <NumberInput aria-label="Percent change" className="w-24" value={percent} onChange={setPercent} />% <span className="text-muted-foreground">(−10 is 10% cheaper)</span>
              </div>
            )}
            <InputGroup>
              <InputGroupAddon>
                <SearchIcon />
              </InputGroupAddon>
              <InputGroupInput placeholder="Search tests" aria-label="Search tests" value={search} onChange={(e) => setSearch(e.target.value)} />
            </InputGroup>
            <p className="text-xs text-muted-foreground">
              {mode === "PERCENT" ? (testIds.size === 0 ? "No tests ticked: every priced test changes." : `${testIds.size} tests ticked.`) : `${fixedItems.length} prices entered.`}
            </p>
            <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
              {shown.map((t) => (
                <div key={t.id} className="flex items-center gap-2 border-b px-3 py-1.5 text-sm last:border-0">
                  {mode === "PERCENT" && <Checkbox aria-label={`Include ${t.name}`} checked={testIds.has(t.id)} onCheckedChange={(v) => setTestIds(toggle(testIds, t.id, v === true))} />}
                  <span className="min-w-0 flex-1 truncate">
                    {t.name} <span className="font-mono text-xs text-muted-foreground">{t.code}</span>
                  </span>
                  {mode === "PERCENT" ? (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      ₹{paiseToRupees(t.pricePaise)}
                      {percent != null && testIds.has(t.id) && <> → ₹{paiseToRupees(Math.round((t.pricePaise * (100 + percent)) / 100))}</>}
                    </span>
                  ) : (
                    <MoneyInput className="w-32" aria-label={`Price for ${t.name}`} placeholder={String(paiseToRupees(t.pricePaise))} value={fixed.get(t.id) ?? null} onChange={(p) => setFixed(new Map(fixed).set(t.id, p))} />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button disabled={!ready || apply.isPending} onClick={() => apply.mutate()}>
            {apply.isPending && <Spinner />}
            Apply to {picked.size} {picked.size === 1 ? "lab" : "labs"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
