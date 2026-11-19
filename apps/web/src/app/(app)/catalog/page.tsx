"use client";

import { Fragment, useDeferredValue, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDownIcon, CopyIcon, FolderTreeIcon, MoreVerticalIcon, SearchIcon, Trash2Icon, SparklesIcon } from "lucide-react";
import { formatINR, sampleTypeLabel } from "@lms/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/app-shell/page-header";
import { useAuth } from "@/providers/auth-provider";
import { api } from "@/lib/api";
import { catalogKeys, useDepartments, useTests } from "@/lib/catalog";
import { DepartmentsDialog } from "./departments-dialog";

const ALL = "all";

type TabKey = "tests" | "profiles";
const TABS: { key: TabKey; label: string }[] = [
  { key: "tests", label: "Tests" },
  { key: "profiles", label: "Profile Tests" },
];

function ImportStarterButton({ variant = "default" }: { variant?: "default" | "outline" }) {
  const queryClient = useQueryClient();
  const importStarter = useMutation({
    mutationFn: () => api<{ created: string[]; skipped: string[] }>("/catalog/import-starter", { method: "POST" }),
    onSuccess: async (r) => {
      toast.success(
        r.created.length
          ? `Added ${r.created.length} tests. Review the reference ranges and set your prices.`
          : "All starter tests are already in your test list.",
      );
      await queryClient.invalidateQueries({ queryKey: catalogKeys.all });
    },
    onError: (err) => toast.error(err.message),
  });
  return (
    <Button variant={variant} onClick={() => importStarter.mutate()} disabled={importStarter.isPending}>
      {importStarter.isPending ? <Spinner /> : <SparklesIcon />}
      Import starter catalog
    </Button>
  );
}

export default function TestListPage() {
  const { can } = useAuth();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [departmentId, setDepartmentId] = useState(ALL);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [tab, setTab] = useState<TabKey>("tests");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const deferredSearch = useDeferredValue(search.trim());

  const departments = useDepartments();
  const tests = useTests({
    search: deferredSearch || undefined,
    departmentId: departmentId === ALL ? undefined : departmentId,
    includeInactive,
  });

  const queryClient = useQueryClient();
  const deleteTest = useMutation({
    mutationFn: (t: { id: string; name: string }) => api<void>(`/catalog/tests/${t.id}`, { method: "DELETE" }),
    onSuccess: async (_r, t) => {
      toast.success(`Deleted ${t.name}`);
      await queryClient.invalidateQueries({ queryKey: catalogKeys.all });
    },
    onError: (err) => toast.error(err.message),
  });

  const duplicateTest = useMutation({
    mutationFn: (t: { id: string; name: string }) =>
      api<{ test: { id: string; name: string; code: string } }>(`/catalog/tests/${t.id}/duplicate`, { method: "POST" }).then((r) => r.test),
    onSuccess: async (copy) => {
      toast.success(`Created ${copy.name} (${copy.code}). Edit it below.`);
      await queryClient.invalidateQueries({ queryKey: catalogKeys.all });
      router.push(`/catalog/${copy.id}`);
    },
    onError: (err) => toast.error(err.message),
  });

  const canWrite = can("catalog:write");
  const filtering = !!deferredSearch || departmentId !== ALL || includeInactive;
  const catalogEmpty = !filtering && tests.data?.length === 0;
  const unpriced = tests.data?.filter((t) => t.isActive && t.pricePaise === 0).length ?? 0;

  const rows = useMemo(
    () => (tests.data ?? []).filter((t) => (tab === "profiles" ? t.isPanel : !t.isPanel)),
    [tests.data, tab],
  );
  const groups = useMemo(() => {
    const m = new Map<string, typeof rows>();
    for (const t of rows) m.set(t.department.name, [...(m.get(t.department.name) ?? []), t]);
    return [...m.entries()];
  }, [rows]);
  const toggleGroup = (d: string) =>
    setCollapsed((prev) => {
      const n = new Set(prev);
      if (!n.delete(d)) n.add(d);
      return n;
    });
  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (!n.delete(id)) n.add(id);
      return n;
    });

  return (
    <>
      <PageHeader
        title="Test List"
        description="Tests and profiles your lab offers, with parameters, reference ranges and prices."
        actions={
          <>
            <DepartmentsDialog
              trigger={
                <Button variant="outline">
                  <FolderTreeIcon /> Departments
                </Button>
              }
            />
            {canWrite && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" disabled={selected.size === 0}>
                    Bulk Actions{selected.size > 0 ? ` (${selected.size})` : ""} <ChevronDownIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setSelected(new Set())}>Clear selection</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {canWrite && (
              <>
                <Button asChild>
                  <Link href="/catalog/new?panel=1">Add Profile</Link>
                </Button>
                <Button asChild>
                  <Link href="/catalog/new">Add New Report</Link>
                </Button>
              </>
            )}
          </>
        }
      />

      {catalogEmpty ? (
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>Your test list is empty</CardTitle>
            <CardDescription>
              Start from about 20 common tests (CBC, LFT, KFT, lipid, thyroid, urine routine and more) with their
              parameters and typical adult reference ranges, or add tests one by one.
            </CardDescription>
          </CardHeader>
          {canWrite && (
            <CardContent className="flex flex-wrap gap-2">
              <ImportStarterButton />
              <Button variant="outline" asChild>
                <Link href="/catalog/new">Add a test</Link>
              </Button>
            </CardContent>
          )}
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <InputGroup className="w-full sm:w-72">
              <InputGroupAddon>
                <SearchIcon />
              </InputGroupAddon>
              <InputGroupInput
                placeholder="Search by name or code"
                aria-label="Search tests"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </InputGroup>
            <Select value={departmentId} onValueChange={setDepartmentId}>
              <SelectTrigger className="w-full sm:w-48" aria-label="Department">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All departments</SelectItem>
                {departments.data?.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <Checkbox
                id="inactive"
                checked={includeInactive}
                onCheckedChange={(v) => setIncludeInactive(v === true)}
              />
              <Label htmlFor="inactive" className="font-normal">
                Show inactive
              </Label>
            </div>
            {canWrite && unpriced > 0 && !filtering && (
              <p className="ml-auto text-sm text-muted-foreground">
                {unpriced} {unpriced === 1 ? "test has" : "tests have"} no price yet
              </p>
            )}
          </div>

          <div className="flex items-center gap-1 border-b">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={
                  tab === t.key
                    ? "-mb-px border-b-2 border-primary px-4 py-2 text-sm font-medium text-primary"
                    : "-mb-px border-b-2 border-transparent px-4 py-2 text-sm text-foreground hover:text-primary"
                }
              >
                {t.label}
              </button>
            ))}
          </div>
          <p className="text-sm font-semibold">Rows: {rows.length}</p>

          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead>Test Name</TableHead>
                  <TableHead>Test Code</TableHead>
                  <TableHead>Price (₹)</TableHead>
                  <TableHead>Sample Type</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Outsourced</TableHead>
                  <TableHead>Outsource Center</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {tests.isPending &&
                  Array.from({ length: 6 }, (_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={9}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    </TableRow>
                  ))}
                {tests.data && rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                      No tests match these filters.
                    </TableCell>
                  </TableRow>
                )}
                {groups.map(([dept, items]) => {
                  const isCollapsed = collapsed.has(dept);
                  return (
                    <Fragment key={dept}>
                      <TableRow
                        className="cursor-pointer bg-muted/30 hover:bg-muted/50"
                        onClick={() => toggleGroup(dept)}
                      >
                        <TableCell colSpan={9} className="py-3">
                          <span className="flex items-center gap-3">
                            <ChevronDownIcon
                              className={`size-4 text-muted-foreground transition-transform ${isCollapsed ? "-rotate-90" : ""}`}
                            />
                            <span>
                              {dept} ({items.length})
                            </span>
                          </span>
                        </TableCell>
                      </TableRow>
                      {!isCollapsed &&
                        items.map((t) => (
                          <TableRow
                            key={t.id}
                            onClick={() => router.push(`/catalog/${t.id}`)}
                            className={t.isActive ? "cursor-pointer" : "cursor-pointer opacity-60"}
                          >
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <Checkbox
                                aria-label={`Select ${t.name}`}
                                checked={selected.has(t.id)}
                                onCheckedChange={() => toggleSelected(t.id)}
                              />
                            </TableCell>
                            <TableCell>
                              <Link
                                href={`/catalog/${t.id}`}
                                className="font-semibold hover:underline"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {t.name}
                              </Link>
                              {t.isPanel && (
                                <Badge variant="secondary" className="ml-2">
                                  Panel · {t.panelTestCount} tests
                                </Badge>
                              )}
                              {t.reportKind === "CULTURE" && (
                                <Badge variant="secondary" className="ml-2">
                                  Culture
                                </Badge>
                              )}
                              {!t.isActive && (
                                <Badge variant="outline" className="ml-2">
                                  Inactive
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="max-w-48 truncate">{t.code}</TableCell>
                            <TableCell className="tabular-nums">
                              {t.pricePaise > 0 ? (
                                formatINR(t.pricePaise)
                              ) : (
                                <Badge variant="outline" className="text-amber-700 dark:text-amber-400">
                                  Not set
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell>{sampleTypeLabel(t.sampleType)}</TableCell>
                            <TableCell className="max-w-40 truncate">{t.department.name}</TableCell>
                            <TableCell>{t.outsourceLab ? "Yes" : "No"}</TableCell>
                            <TableCell>{t.outsourceLab?.name ?? "Self"}</TableCell>
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" aria-label={`Actions for ${t.name}`}>
                                    <MoreVerticalIcon />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem asChild>
                                    <Link href={`/catalog/${t.id}`}>{canWrite ? "Edit" : "View"}</Link>
                                  </DropdownMenuItem>
                                  {canWrite && (
                                    <DropdownMenuItem disabled={duplicateTest.isPending} onClick={() => duplicateTest.mutate(t)}>
                                      <CopyIcon /> Duplicate
                                    </DropdownMenuItem>
                                  )}
                                  {canWrite && (
                                    <DropdownMenuItem
                                      variant="destructive"
                                      onClick={() => {
                                        if (window.confirm(`Delete ${t.name}? This can't be undone.`)) deleteTest.mutate(t);
                                      }}
                                    >
                                      <Trash2Icon /> Delete
                                    </DropdownMenuItem>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                        ))}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {canWrite && !filtering && (
            <div>
              <ImportStarterButton variant="outline" />
            </div>
          )}
        </>
      )}
    </>
  );
}
