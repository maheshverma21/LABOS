"use client";

import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  INSTRUMENT_CONNECTION_HINT,
  INSTRUMENT_CONNECTION_LABEL,
  INSTRUMENT_CONNECTIONS,
  INSTRUMENT_PROTOCOL_LABEL,
  INSTRUMENT_PROTOCOLS,
  instrumentSchema,
  type InstrumentItem,
} from "@lms/shared";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api";
import { showFormError } from "@/lib/forms";
import { instrumentKeys, isOnline } from "@/lib/instruments";
import { formatDateTime } from "@/lib/orders";
import { cn } from "@/lib/utils";

type Values = z.input<typeof instrumentSchema>;

/** Green while the interface program has the analyzer connected. */
export function OnlineDot({ instrument }: { instrument: Pick<InstrumentItem, "lastSeenAt" | "isActive"> }) {
  const online = instrument.isActive && isOnline(instrument);
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className={cn("size-2 rounded-full", online ? "bg-emerald-500" : "bg-muted-foreground/40")} aria-hidden />
      {!instrument.isActive ? "Switched off" : online ? "Connected" : instrument.lastSeenAt ? `Last heard ${formatDateTime(instrument.lastSeenAt)}` : "Not heard from yet"}
    </span>
  );
}

/** Adds or edits an analyzer's connection settings. */
export function InstrumentDialog({ instrument, onClose }: { instrument: InstrumentItem | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const form = useForm<Values, unknown, z.output<typeof instrumentSchema>>({
    resolver: zodResolver(instrumentSchema),
    defaultValues: instrument
      ? { name: instrument.name, model: instrument.model ?? "", protocol: instrument.protocol, connection: instrument.connection, host: instrument.host ?? "", port: instrument.port, isActive: instrument.isActive }
      : { name: "", model: "", protocol: "ASTM", connection: "LISTEN", host: "", port: 5100, isActive: true },
  });
  const { errors } = form.formState;
  const connection = useWatch({ control: form.control, name: "connection" });
  const save = useMutation({
    mutationFn: (v: z.output<typeof instrumentSchema>) =>
      instrument ? api(`/instruments/${instrument.id}`, { method: "PUT", body: v }) : api("/instruments", { method: "POST", body: v }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: instrumentKeys.all });
      toast.success(instrument ? "Saved. The interface program picks it up within a minute." : "Analyzer added. The interface program picks it up within a minute.");
      onClose();
    },
    onError: (err) => showFormError(err, form.setError),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <form noValidate className="grid gap-5" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
          <DialogHeader>
            <DialogTitle>{instrument ? `Edit ${instrument.name}` : "Add an analyzer"}</DialogTitle>
            <DialogDescription>Match these to the analyzer&apos;s LIS (host) communication settings.</DialogDescription>
          </DialogHeader>
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            <Field data-invalid={!!errors.name}>
              <FieldLabel htmlFor="i-name">Name</FieldLabel>
              <Input id="i-name" placeholder="e.g. Haematology" aria-invalid={!!errors.name} {...form.register("name")} />
              <FieldError errors={[errors.name]} />
            </Field>
            <Field>
              <FieldLabel htmlFor="i-model">Make and model</FieldLabel>
              <Input id="i-model" placeholder="e.g. Sysmex XN-330" {...form.register("model")} />
            </Field>
            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="i-protocol">Protocol</FieldLabel>
              <Controller
                control={form.control}
                name="protocol"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="i-protocol" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {INSTRUMENT_PROTOCOLS.map((p) => (
                        <SelectItem key={p} value={p}>
                          {INSTRUMENT_PROTOCOL_LABEL[p]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldDescription>Not sure? Leave ASTM: LabOS recognises HL7 messages by themselves either way.</FieldDescription>
            </Field>
            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="i-connection">Connection</FieldLabel>
              <Controller
                control={form.control}
                name="connection"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="i-connection" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {INSTRUMENT_CONNECTIONS.map((c) => (
                        <SelectItem key={c} value={c}>
                          {INSTRUMENT_CONNECTION_LABEL[c]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldDescription>{INSTRUMENT_CONNECTION_HINT[connection]}</FieldDescription>
            </Field>
            {connection === "CONNECT" && (
              <Field data-invalid={!!errors.host}>
                <FieldLabel htmlFor="i-host">Analyzer IP address</FieldLabel>
                <Input id="i-host" placeholder="192.168.1.50" aria-invalid={!!errors.host} {...form.register("host")} />
                <FieldError errors={[errors.host]} />
              </Field>
            )}
            <Field data-invalid={!!errors.port}>
              <FieldLabel htmlFor="i-port">Port</FieldLabel>
              <Input id="i-port" type="number" inputMode="numeric" aria-invalid={!!errors.port} {...form.register("port")} />
              <FieldError errors={[errors.port]} />
            </Field>
            {instrument && (
              <Field className="sm:col-span-2">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input type="checkbox" className="size-4" {...form.register("isActive")} />
                  Receiving results (untick to pause this analyzer)
                </label>
              </Field>
            )}
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Spinner />}
              {instrument ? "Save" : "Add analyzer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
