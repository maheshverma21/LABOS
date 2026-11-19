"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CopyIcon, KeyRoundIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import type { InstrumentItem, InterfaceKeyItem } from "@lms/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { PageHeader } from "@/components/app-shell/page-header";
import { InstrumentDialog, OnlineDot } from "@/components/analyzers/instrument-dialog";
import { api } from "@/lib/api";
import { APP_NAME } from "@/lib/brand";
import { instrumentKeys, useInstruments, useInterfaceKeys } from "@/lib/instruments";
import { formatDateTime } from "@/lib/orders";


async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied`);
  } catch {
    toast.info(text, { duration: 30_000 });
  }
}

/** The interface program's key and how to start it on the lab PC. */
function InterfaceCard() {
  const queryClient = useQueryClient();
  const { data: keys, isPending } = useInterfaceKeys();
  const [name, setName] = useState("Lab PC");
  const [created, setCreated] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => api<{ key: string; item: InterfaceKeyItem }>("/instruments/keys", { method: "POST", body: { name } }),
    onSuccess: async ({ key }) => {
      setCreated(key);
      await queryClient.invalidateQueries({ queryKey: instrumentKeys.keys() });
    },
    onError: (err) => toast.error(err.message),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/instruments/keys/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: instrumentKeys.keys() });
      toast.success("Key revoked. The interface program using it stops sending.");
    },
    onError: (err) => toast.error(err.message),
  });
  const url = typeof window === "undefined" ? "" : window.location.origin;
  const command = created ? `interface.bat --url ${url} --key ${created}` : "";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Interface program</CardTitle>
        <CardDescription>
          A small program on a PC on the same network as the analyzers. It receives their results and sends them here. One key per PC.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {isPending ? (
          <Skeleton className="h-10 w-full" />
        ) : keys && keys.length > 0 ? (
          <ul className="divide-y rounded-lg border text-sm">
            {keys.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <KeyRoundIcon className="size-4 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{k.name}</div>
                  <div className="text-xs text-muted-foreground">
                    <span className="font-mono">{k.prefix}…</span> · {k.lastUsedAt ? `last used ${formatDateTime(k.lastUsedAt)}` : "not used yet"}
                  </div>
                </div>
                <Button variant="ghost" size="sm" disabled={revoke.isPending} onClick={() => revoke.mutate(k.id)}>
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No key yet. Create one for the PC the analyzers are connected to.</p>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1.5">
            <label htmlFor="key-name" className="text-sm font-medium">
              PC name
            </label>
            <Input id="key-name" className="w-full sm:w-56" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <Button variant="outline" disabled={name.trim().length < 2 || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? <Spinner /> : <PlusIcon />} Create key
          </Button>
        </div>
        <ol className="grid list-decimal gap-1.5 pl-5 text-sm text-muted-foreground">
          <li>Add each analyzer below, with the port it should use.</li>
          <li>On the analyzer&apos;s LIS / host settings, enter that PC&apos;s IP address and the port, and turn on sending results.</li>
          <li>
            On that PC, open the LabOS folder and run <code className="font-mono text-foreground">interface.bat</code> with the key (the first time only). Keep its window
            open.
          </li>
          <li>Run a sample. Its values appear in Results, marked as coming from the analyzer, for the technician to check and submit.</li>
        </ol>
      </CardContent>
      <Dialog open={!!created} onOpenChange={(o) => !o && setCreated(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Your interface key</DialogTitle>
            <DialogDescription>Copy it now: it&apos;s shown only this once. Anyone with it can send results to your lab.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="flex gap-2">
              <Input readOnly className="font-mono text-xs" value={created ?? ""} onFocus={(e) => e.currentTarget.select()} />
              <Button variant="outline" size="icon" aria-label="Copy key" onClick={() => copy(created!, "Key")}>
                <CopyIcon />
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">On the analyzer PC, in the LabOS folder, run this once (it remembers the settings):</p>
            <div className="flex gap-2">
              <Input readOnly className="font-mono text-xs" value={command} onFocus={(e) => e.currentTarget.select()} />
              <Button variant="outline" size="icon" aria-label="Copy command" onClick={() => copy(command, "Command")}>
                <CopyIcon />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              If that PC isn&apos;t this one, replace the address with the one it uses to open LabOS (e.g. http://192.168.1.20:3000).
            </p>
          </div>
          <DialogFooter>
            <Button onClick={() => setCreated(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default function AnalyzersPage() {
  const queryClient = useQueryClient();
  const { data: instruments, isPending } = useInstruments();
  const [editing, setEditing] = useState<InstrumentItem | "new" | null>(null);
  const remove = useMutation({
    mutationFn: (i: InstrumentItem) => api(`/instruments/${i.id}`, { method: "DELETE" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: instrumentKeys.all });
      toast.success("Analyzer removed");
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <>
      <title>{`Analyzers · ${APP_NAME}`}</title>
      <PageHeader
        title="Analyzers"
        description="Lab machines that send their results straight into LabOS."
        actions={
          <Button onClick={() => setEditing("new")}>
            <PlusIcon /> Add analyzer
          </Button>
        }
      />
      <div className="grid max-w-4xl gap-6">
        <Card className="py-0">
          <CardContent className="px-0">
            {isPending ? (
              <Skeleton className="m-4 h-16" />
            ) : !instruments?.length ? (
              <p className="p-6 text-center text-sm text-muted-foreground">No analyzers yet. Add your first one to start receiving results.</p>
            ) : (
              <ul className="divide-y">
                {instruments.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <Link href={`/settings/analyzers/${i.id}`} className="font-medium hover:underline">
                        {i.name}
                      </Link>
                      {i.model && <span className="text-sm text-muted-foreground"> · {i.model}</span>}
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <OnlineDot instrument={i} />
                        <span>
                          {i.protocol} · {i.connection === "LISTEN" ? `port ${i.port}` : `${i.host}:${i.port}`}
                        </span>
                        <span>{i.mappingCount} linked codes</span>
                        <Badge variant="secondary" className="font-normal">
                          {i.messagesToday} today
                        </Badge>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/settings/analyzers/${i.id}`}>Results log &amp; codes</Link>
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setEditing(i)} aria-label={`Edit ${i.name}`}>
                        <PencilIcon />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove ${i.name}`}
                        disabled={remove.isPending}
                        onClick={() => {
                          if (window.confirm(`Remove ${i.name}? Its log and linked codes are deleted too. Results already saved stay.`)) remove.mutate(i);
                        }}
                      >
                        <Trash2Icon />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <InterfaceCard />
      </div>
      {editing && <InstrumentDialog key={editing === "new" ? "new" : editing.id} instrument={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}
