"use client";

import { useMemo, useState } from "react";
import { SearchIcon } from "lucide-react";
import { formatINR } from "@lms/shared";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePortalCatalog } from "@/lib/portal";

export default function PortalRates() {
  const { data, isPending } = usePortalCatalog();
  const [search, setSearch] = useState("");
  const q = search.trim().toLowerCase();
  const rows = useMemo(() => (data ?? []).filter((t) => !q || t.name.toLowerCase().includes(q) || t.code.toLowerCase().includes(q)), [data, q]);
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">My rates</h1>
      <InputGroup className="w-full sm:w-72">
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput placeholder="Search tests" aria-label="Search tests" value={search} onChange={(e) => setSearch(e.target.value)} />
      </InputGroup>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Test</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Sample</TableHead>
              <TableHead>Report in</TableHead>
              <TableHead className="text-right">Your price</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending && (
              <TableRow>
                <TableCell colSpan={5}>
                  <Skeleton className="h-5 w-full" />
                </TableCell>
              </TableRow>
            )}
            {rows.map((t) => (
              <TableRow key={t.id}>
                <TableCell>
                  {t.name} <span className="font-mono text-xs text-muted-foreground">{t.code}</span>
                  {t.isPanel && <span className="ml-2 text-xs text-muted-foreground">Package</span>}
                </TableCell>
                <TableCell>{t.department.name}</TableCell>
                <TableCell>{t.sampleType ?? "—"}</TableCell>
                <TableCell>{t.tatHours ? `${t.tatHours} h` : "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{formatINR(t.pricePaise)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
