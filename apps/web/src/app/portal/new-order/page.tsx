"use client";

import { useDeferredValue, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { SearchIcon } from "lucide-react";
import { createPatientSchema, SALUTATIONS, type PatientListItem, type PatientSex, type PortalOrderItem } from "@lms/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { PreviewDialog } from "@/components/reports/preview-dialog";
import { api } from "@/lib/api";
import { usePortalPatients, usePortalSummary } from "@/lib/portal";
import { AddBillDialog, type BillAction } from "./add-bill-dialog";

const label = "text-sm font-normal";
const Req = () => <span className="mr-1 text-red-600">*</span>;
const empty = { salutation: "Mr", first: "", last: "", age: "", ageType: "years", dob: "", sex: "MALE" as PatientSex, phone: "", barcode: "", referral: "", address: "", passport: "", history: "" };

export default function PortalNewOrder() {
  const [f, setF] = useState(empty);
  const set = <K extends keyof typeof empty>(k: K, v: (typeof empty)[K]) => setF((x) => ({ ...x, [k]: v }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [patient, setPatient] = useState<{ p: PatientListItem; barcode: string | null } | null>(null);
  const [placed, setPlaced] = useState<{ order: PortalOrderItem; action: BillAction } | null>(null);
  const [find, setFind] = useState("");
  const fq = useDeferredValue(find.trim());
  const found = usePortalPatients(fq);
  // Switches the lab set on this client's page.
  const features = usePortalSummary().data?.features;
  const showBarcode = features?.barcodeEdit !== false;
  const showReferral = features?.allowAddReferralDoctor !== false;

  const create = useMutation({
    mutationFn: (body: unknown) => api<{ patient: PatientListItem }>("/b2b/patients", { method: "POST", body }),
    onSuccess: ({ patient: p }) => setPatient({ p, barcode: showBarcode ? f.barcode.trim() || null : null }),
    onError: (err) => toast.error(err.message),
  });

  const submit = () => {
    const n = Number(f.age) || 0;
    const parsed = createPatientSchema.safeParse({
      salutation: f.salutation,
      name: [f.first, f.last].map((x) => x.trim()).filter(Boolean).join(" "),
      sex: f.sex,
      ...(f.dob ? { dob: f.dob } : { age: { years: f.ageType === "years" ? n : 0, months: f.ageType === "months" ? n : 0, days: f.ageType === "days" ? n : 0 } }),
      phone: f.phone || null,
      barcode: showBarcode ? f.barcode || null : null,
      referral: showReferral ? f.referral || null : null,
      address: f.address || null,
      passportNumber: f.passport || null,
      notes: f.history || null,
      // The client confirms the patient's consent by creating the order.
      consent: true,
      allowDuplicate: true,
    });
    if (!parsed.success) {
      const e: Record<string, string> = {};
      for (const i of parsed.error.issues) e[String(i.path[0] ?? "form")] ??= i.message;
      setErrors(e);
      return;
    }
    setErrors({});
    create.mutate(parsed.data);
  };

  const reset = () => {
    setF(empty);
    setPatient(null);
    setPlaced(null);
    setFind("");
  };
  const err = (k: string) => (errors[k] ? <p className="mt-1 text-xs text-destructive">{errors[k]}</p> : null);

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">New order</h1>

      <div className="relative">
        <div className="relative max-w-md">
          <SearchIcon className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
          <Input className="pl-9" aria-label="Find an existing patient" placeholder="Existing patient? Search by name, mobile or ID" value={find} onChange={(e) => setFind(e.target.value)} />
          {fq && (
            <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-popover shadow-md">
              {found.data?.length === 0 && <li className="p-3 text-sm text-muted-foreground">No patient matches. Fill in the form below.</li>}
              {found.data?.map((p) => (
                <li key={p.id}>
                  <button type="button" className="flex w-full justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => setPatient({ p, barcode: null })}>
                    <span>{p.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {p.uhid} {p.phone ?? ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="space-y-5">
          <div className="grid gap-4 md:grid-cols-[8rem_1fr_1fr_9rem_9rem_auto_11rem]">
            <div className="space-y-1.5">
              <Label className={label}>
                <Req />
                Designation
              </Label>
              <Select
                value={f.salutation}
                onValueChange={(v) => {
                  set("salutation", v);
                  const implied = SALUTATIONS.find((s) => s.key === v)?.sex;
                  if (implied) set("sex", implied);
                }}
              >
                <SelectTrigger className="w-full" aria-label="Designation">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SALUTATIONS.map((s) => (
                    <SelectItem key={s.key} value={s.key}>
                      {s.key.toUpperCase()}.
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className={label} htmlFor="o-first">
                <Req />
                First Name
              </Label>
              <Input id="o-first" placeholder="First Name" value={f.first} onChange={(e) => set("first", e.target.value)} aria-invalid={!!errors.name} />
              {err("name")}
            </div>
            <div className="space-y-1.5">
              <Label className={label} htmlFor="o-last">
                Last Name
              </Label>
              <Input id="o-last" placeholder="Last Name" value={f.last} onChange={(e) => set("last", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className={label} htmlFor="o-age">
                <Req />
                Age
              </Label>
              <Input id="o-age" inputMode="numeric" placeholder="Enter Age" disabled={!!f.dob} value={f.age} onChange={(e) => set("age", e.target.value.replace(/\D/g, "").slice(0, 3))} aria-invalid={!!errors.age} />
              {err("age")}
            </div>
            <div className="space-y-1.5">
              <Label className={label}>Age Type</Label>
              <Select value={f.ageType} onValueChange={(v) => set("ageType", v)} disabled={!!f.dob}>
                <SelectTrigger className="w-full" aria-label="Age type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="years">Year</SelectItem>
                  <SelectItem value="months">Month</SelectItem>
                  <SelectItem value="days">Day</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end pb-2 text-sm">or</div>
            <div className="space-y-1.5">
              <Label className={label} htmlFor="o-dob">
                <Req />
                DOB
              </Label>
              <Input id="o-dob" type="date" max={new Date().toISOString().slice(0, 10)} value={f.dob} onChange={(e) => set("dob", e.target.value)} aria-invalid={!!errors.dob} />
              {err("dob")}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-[14rem_1fr_14rem_1fr]">
            <div className="space-y-2">
              <Label className={label}>
                <Req />
                Gender
              </Label>
              <div className="flex gap-4 pt-1" role="radiogroup" aria-label="Gender">
                {(["MALE", "FEMALE", "OTHER"] as const).map((s) => (
                  <label key={s} className="flex items-center gap-1.5 text-sm lowercase">
                    <input type="radio" name="gender" className="accent-primary" checked={f.sex === s} onChange={() => set("sex", s)} />
                    {s}
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className={label} htmlFor="o-phone">
                Phone Number
              </Label>
              <div className="flex">
                <span className="flex items-center rounded-l-md border border-r-0 bg-muted px-3 text-sm whitespace-nowrap">IN +91</span>
                <Input id="o-phone" className="rounded-l-none" inputMode="numeric" maxLength={10} placeholder="Enter Phone Number" value={f.phone} onChange={(e) => set("phone", e.target.value.replace(/\D/g, ""))} aria-invalid={!!errors.phone} />
              </div>
              {err("phone")}
            </div>
            {showBarcode && (
              <div className="space-y-1.5">
                <Label className={label} htmlFor="o-barcode">
                  Barcode
                </Label>
                <Input id="o-barcode" placeholder="Enter Barcode" maxLength={40} value={f.barcode} onChange={(e) => set("barcode", e.target.value)} />
              </div>
            )}
            {showReferral && (
              <div className="space-y-1.5">
                <Label className={label} htmlFor="o-ref">
                  Referral Doctor
                </Label>
                <Input id="o-ref" placeholder="Referral Doctor" value={f.referral} onChange={(e) => set("referral", e.target.value)} />
              </div>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label className={label} htmlFor="o-addr">
                Address
              </Label>
              <textarea id="o-addr" placeholder="Enter Address...." value={f.address} onChange={(e) => set("address", e.target.value)} className="min-h-9 w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50" />
            </div>
            <div className="space-y-1.5">
              <Label className={label} htmlFor="o-passport">
                Passport Number
              </Label>
              <Input id="o-passport" placeholder="Enter Passport Number" value={f.passport} onChange={(e) => set("passport", e.target.value)} />
            </div>
            <div className="space-y-1.5 md:col-span-3">
              <Label className={label} htmlFor="o-history">
                Clinical History
              </Label>
              <textarea id="o-history" placeholder="Enter Clinical History" value={f.history} onChange={(e) => set("history", e.target.value)} className="min-h-16 w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50" />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-3">
        <p className="text-xs text-muted-foreground">By creating the order you confirm the patient agrees to their details being processed for testing.</p>
        <Button disabled={create.isPending} onClick={submit}>
          {create.isPending && <Spinner />}
          Create Order
        </Button>
      </div>

      {patient && !placed && (
        <AddBillDialog patient={patient.p} barcode={patient.barcode} onClose={() => setPatient(null)} onPlaced={(order, action) => setPlaced({ order, action })} />
      )}
      {placed && (
        <PreviewDialog
          portal
          r={{ orderId: placed.order.id, orderNo: placed.order.orderNo, patient: { salutation: null, name: placed.order.patient.name } }}
          preview={placed.action === "bill" ? { kind: "bill" } : { kind: "barcode" }}
          onClose={reset}
        />
      )}
    </>
  );
}
