"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PlusIcon, SearchIcon } from "lucide-react";
import { formatINR, PRICE_LIST_TYPES, PRICE_LIST_TYPE_LABELS, priceListSchema, type PriceListDetail, type PriceListType } from "@lms/shared";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MoneyInput } from "@/components/inputs/money-input";
import { PageHeader } from "@/components/app-shell/page-header";
import { useAuth } from "@/providers/auth-provider";
import { api } from "@/lib/api";
import { catalogKeys, usePriceLists, useTests } from "@/lib/catalog";
import { showFormError } from "@/lib/forms";

function NewPriceListDialog({ onCreated }: { onCreated: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const form = useForm<z.input<typeof priceListSchema>>({
    resolver: zodResolver(priceListSchema),
    defaultValues: { name: "", type: "DOCTOR" },
  });
  const create = useMutation({
    mutationFn: (v: { name: string; type: PriceListType }) =>
      api<{ priceList: { id: string } }>("/catalog/price-lists", { method: "POST", body: v }),
    onSuccess: async (r) => {
      await queryClient.invalidateQueries({ queryKey: catalogKeys.priceLists() });
      setOpen(false);
      onCreated(r.priceList.id);
    },
    onError: (err) => showFormError(err, form.setError),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) form.reset();
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <PlusIcon /> New price list
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form
          noValidate
          className="grid gap-4"
          onSubmit={form.handleSubmit((v) => create.mutate(priceListSchema.parse(v)))}
        >
          <DialogHeader>
            <DialogTitle>New price list</DialogTitle>
            <DialogDescription>
              For a hospital, clinic, corporate client or health camp. Tests you don&apos;t price here use their base
              price.
            </DialogDescription>
          </DialogHeader>
          <Field data-invalid={!!form.formState.errors.name}>
            <FieldLabel htmlFor="pl-name">Name</FieldLabel>
            <Input id="pl-name" placeholder="e.g. City Hospital (B2B)" {...form.register("name")} />
            <FieldError errors={[form.formState.errors.name]} />
          </Field>
          <Field>
            <FieldLabel htmlFor="pl-type">Type</FieldLabel>
            <Select value={form.watch("type")} onValueChange={(v) => form.setValue("type", v as PriceListType)}>
              <SelectTrigger id="pl-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRICE_LIST_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {PRICE_LIST_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending && <Spinner />}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PriceGrid({ list }: { list: PriceListDetail }) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const tests = useTests();
  const [search, setSearch] = useState("");
  const q = useDeferredValue(search.trim().toLowerCase());
  const saved = useMemo(() => new Map(list.items.map((i) => [i.testId, i.pricePaise])), [list]);
  const [edits, setEdits] = useState<Map<string, number | null>>(new Map());
  const readOnly = !can("catalog:write");

  const rows = (tests.data ?? []).filter(
    (t) => !q || t.name.toLowerCase().includes(q) || t.code.toLowerCase().includes(q),
  );
  const changes = [...edits].filter(([testId, price]) => (saved.get(testId) ?? null) !== price);

  const save = useMutation({
    mutationFn: () =>
      api<{ priceList: PriceListDetail }>(`/catalog/price-lists/${list.id}/items`, {
        method: "PUT",
        body: { items: changes.map(([testId, pricePaise]) => ({ testId, pricePaise })) },
      }),
    onSuccess: async (r) => {
      queryClient.setQueryData(catalogKeys.priceList(list.id), r.priceList);
      await queryClient.invalidateQueries({ queryKey: catalogKeys.priceLists() });
      setEdits(new Map());
      toast.success("Prices saved");
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <InputGroup className="w-full sm:w-72">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            placeholder="Search tests"
            aria-label="Search tests"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </InputGroup>
        <p className="text-sm text-muted-foreground">Leave a price empty to use the base price.</p>
        {!readOnly && (
          <div className="ml-auto flex items-center gap-2">
            {changes.length > 0 && (
              <>
                <span className="text-sm text-muted-foreground">
                  {changes.length} unsaved {changes.length === 1 ? "change" : "changes"}
                </span>
                <Button variant="outline" onClick={() => setEdits(new Map())}>
                  Discard
                </Button>
              </>
            )}
            <Button disabled={changes.length === 0 || save.isPending} onClick={() => save.mutate()}>
              {save.isPending && <Spinner />}
              Save prices
            </Button>
          </div>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">Code</TableHead>
              <TableHead>Test</TableHead>
              <TableHead className="text-right">Base price</TableHead>
              <TableHead className="w-44 text-right">{list.name}</TableHead>
              <TableHead className="hidden w-24 text-right md:table-cell">Difference</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tests.isPending && (
              <TableRow>
                <TableCell colSpan={5}>
                  <Skeleton className="h-5 w-full" />
                </TableCell>
              </TableRow>
            )}
            {rows.map((t) => {
              const value = edits.has(t.id) ? edits.get(t.id)! : (saved.get(t.id) ?? null);
              const diff = value != null && t.pricePaise > 0 ? Math.round(((value - t.pricePaise) / t.pricePaise) * 100) : null;
              return (
                <TableRow key={t.id} data-state={edits.has(t.id) ? "selected" : undefined}>
                  <TableCell className="font-mono text-xs">{t.code}</TableCell>
                  <TableCell>{t.name}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {t.pricePaise ? formatINR(t.pricePaise) : "Not set"}
                  </TableCell>
                  <TableCell className="text-right">
                    <MoneyInput
                      aria-label={`${list.name} price for ${t.name}`}
                      className="ml-auto w-36"
                      disabled={readOnly}
                      placeholder={t.pricePaise ? String(t.pricePaise / 100) : ""}
                      value={value}
                      onChange={(p) => setEdits((prev) => new Map(prev).set(t.id, p))}
                    />
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums text-muted-foreground md:table-cell">
                    {diff == null ? "" : `${diff > 0 ? "+" : ""}${diff}%`}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export default function PriceListsPage() {
  const { can } = useAuth();
  const lists = usePriceLists();
  const [selected, setSelected] = useState<string | null>(null);
  const activeId = selected ?? lists.data?.[0]?.id ?? null;

  const detail = useQuery({
    queryKey: catalogKeys.priceList(activeId ?? ""),
    queryFn: () => api<{ priceList: PriceListDetail }>(`/catalog/price-lists/${activeId}`).then((r) => r.priceList),
    enabled: !!activeId,
  });

  return (
    <>
      <PageHeader
        title="Price lists"
        description="Special rates for B2B clients, referring doctors or camps."
        actions={
          <>
            {lists.data && lists.data.length > 0 && (
              <Select value={activeId ?? undefined} onValueChange={setSelected}>
                <SelectTrigger className="w-full sm:w-56" aria-label="Price list">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {lists.data.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name} · {PRICE_LIST_TYPE_LABELS[l.type]} ({l.itemCount})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {can("catalog:write") && <NewPriceListDialog onCreated={setSelected} />}
          </>
        }
      />

      {lists.isPending && <Skeleton className="h-40 w-full" />}
      {lists.data?.length === 0 && (
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>No price lists yet</CardTitle>
            <CardDescription>
              Everyone pays the base price set on each test. Create a price list when a hospital, clinic or corporate
              client gets different rates.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
      {/* Re-mount per list so unsaved edits don't carry over between lists. */}
      {detail.data && <PriceGrid key={detail.data.id} list={detail.data} />}
    </>
  );
}
