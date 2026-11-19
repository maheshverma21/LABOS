"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlignCenterIcon, AlignLeftIcon, AlignRightIcon, ChevronDownIcon, PlusIcon } from "lucide-react";
import {
  DEFAULT_REPORT_DOCTOR,
  type DoctorAlignment,
  type DoctorPosition,
  type ReportDoctorItem,
  type ReportDoctorValues,
} from "@lms/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { brandingKeys, useReportDoctors } from "@/lib/branding";
import { useDepartments } from "@/lib/catalog";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";
import { ImageUpload } from "./report-details";

const ALIGNMENTS: { v: DoctorAlignment; icon: typeof AlignLeftIcon; label: string }[] = [
  { v: "LEFT", icon: AlignLeftIcon, label: "Align left" },
  { v: "CENTER", icon: AlignCenterIcon, label: "Align centre" },
  { v: "RIGHT", icon: AlignRightIcon, label: "Align right" },
];

/** Picks departments; nothing picked means all. */
function DepartmentPicker({ value, onChange, disabled }: { value: string[]; onChange: (v: string[]) => void; disabled: boolean }) {
  const { data: departments } = useDepartments();
  const toggle = (name: string, on: boolean) => onChange(on ? [...value, name] : value.filter((n) => n !== name));
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" disabled={disabled} className="h-auto min-h-9 w-full justify-between font-normal">
          <span className="flex flex-wrap gap-1">
            {value.length === 0 ? (
              <span className="rounded bg-muted px-2 py-0.5 text-sm">All</span>
            ) : (
              value.map((n) => (
                <span key={n} className="rounded bg-muted px-2 py-0.5 text-sm">
                  {n}
                </span>
              ))
            )}
          </span>
          <ChevronDownIcon className="opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-2">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox checked={value.length === 0} onCheckedChange={() => onChange([])} />
          All departments
        </label>
        {(departments ?? []).map((d) => (
          <label key={d.id} className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox checked={value.includes(d.name)} onCheckedChange={(v) => toggle(d.name, v === true)} />
            {d.name}
          </label>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function NumberField({
  id,
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  min: number;
  max: number;
  step?: number;
  disabled: boolean;
}) {
  const n = Number(value);
  const error = value.trim() === "" || !Number.isFinite(n) || n < min || n > max ? `Enter ${min} to ${max}` : null;
  return (
    <Field data-invalid={!!error}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input id={id} type="number" inputMode="decimal" min={min} max={max} step={step} disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error} />
      {error && <FieldError>{error}</FieldError>}
    </Field>
  );
}

const toText = (d: ReportDoctorValues) => ({
  name: d.name,
  degree: d.degree ?? "",
  nameFont: String(d.nameFontSize),
  degreeFont: String(d.degreeFontSize),
  sigSize: String(d.signatureSize),
  spacing: String(d.spacing),
  ndSpacing: String(d.nameDegreeSpacing),
});

/** One doctor: their signature and how it prints. A new doctor is only created once saved. */
function DoctorCard({ doctor, onDiscard }: { doctor: ReportDoctorItem | null; onDiscard?: () => void }) {
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const editable = can("settings:write");
  const start = doctor ?? { ...DEFAULT_REPORT_DOCTOR, id: "" };
  const [t, setT] = useState(toText(start));
  const [signatureId, setSignatureId] = useState(start.signatureId);
  const [hideName, setHideName] = useState(start.hideName);
  const [position, setPosition] = useState<DoctorPosition>(start.position);
  const [alignment, setAlignment] = useState<DoctorAlignment>(start.alignment);
  const [mode, setMode] = useState(start.mode);
  const [endOfReport, setEndOfReport] = useState(start.endOfReport);
  const [departments, setDepartments] = useState(start.departments);
  const set = (k: keyof typeof t) => (v: string) => setT((o) => ({ ...o, [k]: v }));

  const num = (v: string) => Number(v);
  const bad = (v: string, min: number, max: number) => v.trim() === "" || !Number.isFinite(num(v)) || num(v) < min || num(v) > max;
  const nameError = t.name.trim() ? null : "Enter the doctor's name";
  const invalid =
    !!nameError || bad(t.nameFont, 6, 30) || bad(t.degreeFont, 5, 24) || bad(t.sigSize, 10, 150) || bad(t.spacing, 0, 40) || bad(t.ndSpacing, 0, 40);

  const body = (): ReportDoctorValues => ({
    name: t.name.trim(),
    degree: t.degree.trim() || null,
    signatureId,
    hideName,
    position,
    nameFontSize: Math.round(num(t.nameFont)),
    degreeFontSize: Math.round(num(t.degreeFont)),
    signatureSize: Math.round(num(t.sigSize)),
    spacing: num(t.spacing),
    nameDegreeSpacing: num(t.ndSpacing),
    alignment,
    mode,
    endOfReport,
    departments,
  });

  const saved = doctor ? JSON.stringify({ ...doctor, id: undefined }) : "";
  const dirty = !doctor || JSON.stringify({ ...body(), id: undefined }) !== saved;

  const done = async (msg: string) => {
    await queryClient.invalidateQueries({ queryKey: brandingKeys.doctors });
    toast.success(msg);
  };
  const save = useMutation({
    mutationFn: () =>
      doctor ? api(`/lab/report-doctors/${doctor.id}`, { method: "PUT", body: body() }) : api("/lab/report-doctors", { method: "POST", body: body() }),
    onSuccess: async () => {
      await done("Saved");
      onDiscard?.();
    },
    onError: (err) => toast.error(err.message),
  });
  const remove = useMutation({
    mutationFn: () => api(`/lab/report-doctors/${doctor!.id}`, { method: "DELETE" }),
    onSuccess: () => done("Doctor removed"),
    onError: (err) => toast.error(err.message),
  });

  return (
    <Card>
      <CardContent className="grid gap-6">
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          <div className="grid content-start gap-3">
            <Field data-invalid={!!nameError}>
              <FieldLabel htmlFor={`dn-${start.id}`}>
                <span className="text-destructive">*</span> Doctor Name
              </FieldLabel>
              <Input id={`dn-${start.id}`} maxLength={80} disabled={!editable} value={t.name} onChange={(e) => set("name")(e.target.value)} aria-invalid={!!nameError} />
              {nameError && <FieldError>{nameError}</FieldError>}
            </Field>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={hideName} disabled={!editable} onCheckedChange={(v) => setHideName(v === true)} />
              Hide name in report
            </label>
          </div>
          <Field>
            <FieldLabel htmlFor={`dd-${start.id}`}>Degree</FieldLabel>
            <Textarea id={`dd-${start.id}`} rows={3} maxLength={300} disabled={!editable} value={t.degree} onChange={(e) => set("degree")(e.target.value)} />
          </Field>
          <ImageUpload
            kind="DOCTOR_SIGNATURE"
            label="Signature"
            fileLabel={t.name.trim() || "Signature"}
            cleanUp
            assetId={signatureId}
            disabled={!editable}
            onChange={setSignatureId}
          />
        </div>

        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="grid w-full max-w-md gap-2">
            <span className="text-sm font-medium">Position</span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              disabled={!editable}
              value={position}
              onChange={(e) => setPosition(Number(e.target.value))}
              aria-label="Position"
              className="w-full accent-primary"
            />
            <div className="flex items-center justify-between text-sm">
              <button type="button" disabled={!editable} onClick={() => setPosition(0)} className={cn(position === 0 && "font-medium text-primary")}>
                Left
              </button>
              <button type="button" disabled={!editable} onClick={() => setPosition(50)} className={cn(position === 50 && "font-medium text-primary")}>
                Middle
              </button>
              <button type="button" disabled={!editable} onClick={() => setPosition(100)} className={cn(position === 100 && "font-medium text-primary")}>
                Right
              </button>
            </div>
            <p className="text-xs text-muted-foreground">Drag to place the signature anywhere across the page ({position}% from the left).</p>
          </div>
          {editable && doctor && (
            <Button type="button" variant="outline" className="text-primary" disabled={remove.isPending} onClick={() => remove.mutate()}>
              {remove.isPending && <Spinner />}
              Remove Doctor
            </Button>
          )}
          {editable && !doctor && onDiscard && (
            <Button type="button" variant="outline" onClick={onDiscard}>
              Discard
            </Button>
          )}
        </div>

        <hr />

        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          <NumberField id={`nf-${start.id}`} label="Doctor Name font size" value={t.nameFont} onChange={set("nameFont")} min={6} max={30} disabled={!editable} />
          <NumberField id={`df-${start.id}`} label="Degree font size" value={t.degreeFont} onChange={set("degreeFont")} min={5} max={24} disabled={!editable} />
          <NumberField id={`ss-${start.id}`} label="Doctor Signature Size" value={t.sigSize} onChange={set("sigSize")} min={10} max={150} disabled={!editable} />
          <NumberField id={`sp-${start.id}`} label="Spacing" value={t.spacing} onChange={set("spacing")} min={0} max={40} step={0.5} disabled={!editable} />
          <NumberField id={`nd-${start.id}`} label="Spacing b/w Doctor name & Degree" value={t.ndSpacing} onChange={set("ndSpacing")} min={0} max={40} step={0.5} disabled={!editable} />
          <div className="grid content-start gap-2">
            <span className="text-sm font-medium">Alignment</span>
            <div role="radiogroup" aria-label="Alignment" className="flex w-fit rounded-lg border bg-muted p-1">
              {ALIGNMENTS.map(({ v, icon: Icon, label }) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={alignment === v}
                  aria-label={label}
                  disabled={!editable}
                  onClick={() => setAlignment(v)}
                  className={cn("rounded-md px-4 py-1.5", alignment === v ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}
                >
                  <Icon className="size-4" />
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 text-sm">
          <div className="flex flex-wrap items-center gap-6" role="radiogroup" aria-label="Signature setting">
            <span>Signature Setting :</span>
            {(["FIXED", "SELECT"] as const).map((m) => (
              <label key={m} className="flex cursor-pointer items-center gap-2">
                <input type="radio" name={`mode-${start.id}`} className="size-4 accent-primary" disabled={!editable} checked={mode === m} onChange={() => setMode(m)} />
                {m === "FIXED" ? "Fixed" : "Select"}
              </label>
            ))}
          </div>
          <label className="flex cursor-pointer items-center gap-2 md:mr-24">
            <Checkbox checked={endOfReport} disabled={!editable} onCheckedChange={(v) => setEndOfReport(v === true)} />
            End of Report
          </label>
        </div>
        <p className="-mt-3 text-xs text-muted-foreground">
          Fixed prints on every report. Select prints only when you tick the doctor in the report preview. End of Report prints the signature once after the
          last test; otherwise it prints at the bottom of every page.
        </p>

        <div className="grid max-w-2xl gap-2">
          <span className="text-sm font-medium">Department</span>
          <DepartmentPicker value={departments} onChange={setDepartments} disabled={!editable} />
        </div>

        {editable && (
          <div className="flex justify-end">
            <Button disabled={!dirty || invalid || save.isPending} onClick={() => save.mutate()}>
              {save.isPending && <Spinner />}
              {doctor ? "Save" : "Add doctor"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** The "Doctor Details" tab: who signs reports, and how each signature prints. */
export function DoctorDetails() {
  const { data: doctors, isPending } = useReportDoctors();
  const { can } = useAuth();
  const [drafts, setDrafts] = useState<number[]>([]);
  const [n, setN] = useState(0);

  if (isPending) return <Skeleton className="h-64 w-full" />;
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Doctors added here sign your reports, with their own layout. With none added, reports show the signature of whoever approved the results.
      </p>
      {(doctors ?? []).map((d) => (
        <DoctorCard key={`${d.id}-${JSON.stringify(d)}`} doctor={d} />
      ))}
      {drafts.map((k) => (
        <DoctorCard key={`new-${k}`} doctor={null} onDiscard={() => setDrafts((l) => l.filter((x) => x !== k))} />
      ))}
      {can("settings:write") && (
        <Button
          onClick={() => {
            setDrafts((l) => [...l, n]);
            setN(n + 1);
          }}
        >
          <PlusIcon /> Add Doctor
        </Button>
      )}
    </div>
  );
}
