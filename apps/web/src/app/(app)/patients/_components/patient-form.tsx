"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { UsersIcon } from "lucide-react";
import { z } from "zod";
import {
  ageOn,
  formatMobile,
  normalizeIndianMobile,
  PATIENT_SEXES,
  patientDisplayName,
  patientSchema,
  SALUTATIONS,
  SEX_LABEL,
  todayIST,
  type DuplicatePatientDetails,
  type PatientDetail,
  type PatientListItem,
} from "@lms/shared";
import { loadRegistrationSettings, REQUIRED_FIELD_OPTIONS, useRegistrationSettings } from "@/lib/registration-settings";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { NumberInput } from "@/components/inputs/number-input";
import { ApiError, api } from "@/lib/api";
import { showFormError } from "@/lib/forms";
import { ageSex, patientKeys, useDoctors, useNextPatientId, usePatientsByPhone } from "@/lib/patients";
import { DoctorPicker } from "@/components/doctors/doctor-picker";
import { cn } from "@/lib/utils";

// The API schema plus the consent tick, which the form needs as a checkbox.
const formSchema = patientSchema.and(
  z.object({ consent: z.boolean().refine((v) => v, "The patient's consent is required") }),
);
type FormValues = z.input<typeof formSchema>;
type FormOutput = z.output<typeof formSchema>;

const NO_TITLE = "none";

function toFormValues(p?: PatientDetail): FormValues {
  if (!p) {
    const quick = loadRegistrationSettings().quick;
    return {
      salutation: null,
      name: "",
      sex: "" as FormValues["sex"],
      dob: null,
      age: { years: 0, months: 0, days: 0 },
      phone: "",
      altPhone: "",
      email: "",
      address: "",
      city: "",
      pincode: "",
      abhaNumber: "",
      abhaAddress: "",
      patientType: quick.patientType,
      phoneBelongsTo: "Patient",
      organisation: quick.organisation,
      referral: quick.referral,
      state: "",
      district: "",
      passportNumber: "",
      barcode: "",
      country: "India",
      notes: "",
      consent: true,
    };
  }
  return {
    salutation: (p.salutation as FormValues["salutation"]) ?? null,
    name: p.name,
    sex: p.sex,
    // An estimated date of birth is edited as an age, as it was entered.
    dob: p.dobEstimated ? null : p.dob,
    age: p.dobEstimated ? ageOn(p.dob) : null,
    phone: p.phone ?? "",
    altPhone: p.altPhone ?? "",
    email: p.email ?? "",
    address: p.address ?? "",
    city: p.city ?? "",
    pincode: p.pincode ?? "",
    abhaNumber: p.abhaNumber ?? "",
    abhaAddress: p.abhaAddress ?? "",
    patientType: p.patientType ?? "",
    phoneBelongsTo: p.phoneBelongsTo ?? "Patient",
    organisation: p.organisation ?? "",
    referral: p.referral ?? "",
    state: p.state ?? "",
    district: p.district ?? "",
    passportNumber: p.passportNumber ?? "",
    barcode: p.barcode ?? "",
    country: p.country ?? "",
    notes: p.notes ?? "",
    consent: true,
  };
}

function SameNumberPatients({ phone, onOpen }: { phone: string | null; onOpen?: (p: PatientListItem) => void }) {
  const { data } = usePatientsByPhone(phone);
  if (!phone || !data?.length) return null;
  return (
    <Alert>
      <UsersIcon />
      <AlertTitle>Already registered on {formatMobile(phone)}</AlertTitle>
      <AlertDescription>
        <ul className="mt-1 w-full space-y-1">
          {data.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-mono text-xs">{p.uhid}</span>
              <span className="font-medium text-foreground">{patientDisplayName(p)}</span>
              <span>{ageSex(p)}</span>
              <Button asChild size="sm" variant="outline" className="ml-auto h-7" onClick={() => onOpen?.(p)}>
                <Link href={`/patients/${p.id}`}>Open</Link>
              </Button>
            </li>
          ))}
        </ul>
        <p className="mt-2">If this is someone new on the same number, carry on below.</p>
      </AlertDescription>
    </Alert>
  );
}

function DuplicateDialog({
  candidates,
  onClose,
  onRegisterAnyway,
  pending,
}: {
  candidates: PatientListItem[] | null;
  onClose: () => void;
  onRegisterAnyway: () => void;
  pending: boolean;
}) {
  return (
    <Dialog open={!!candidates} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>This patient may already be registered</DialogTitle>
          <DialogDescription>
            Use the existing record so their reports stay in one place. Register a new one only if it&apos;s a different
            person.
          </DialogDescription>
        </DialogHeader>
        <ul className="divide-y rounded-lg border text-sm">
          {candidates?.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{patientDisplayName(p)}</div>
                <div className="text-xs text-muted-foreground">
                  {p.uhid} · {ageSex(p)}
                  {p.phone && ` · ${formatMobile(p.phone)}`}
                </div>
              </div>
              <Button asChild size="sm">
                <Link href={`/patients/${p.id}`}>Use this patient</Link>
              </Button>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={onRegisterAnyway} disabled={pending}>
            {pending && <Spinner />}
            Register as a new patient
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PatientForm({
  patient,
  onSaved,
  onCancel,
}: {
  /** Omit to register a new patient. */
  patient?: PatientDetail;
  /** `bill` is true when the user chose "Register And Bill". */
  onSaved: (p: PatientDetail, opts?: { bill: boolean }) => void;
  onCancel?: () => void;
}) {
  const isNew = !patient;
  const queryClient = useQueryClient();
  const billAfter = useRef(false);
  // An existing patient's number is only changed on purpose.
  const [phoneLocked, setPhoneLocked] = useState(!!patient);
  const [ageUnit, setAgeUnit] = useState<"years" | "months" | "days">("years");
  const [parts, setParts] = useState(() => {
    const d = patient && !patient.dobEstimated ? patient.dob : null;
    return d ? { y: d.slice(0, 4), m: String(Number(d.slice(5, 7))), d: String(Number(d.slice(8, 10))) } : { y: "", m: "", d: "" };
  });
  const [duplicates, setDuplicates] = useState<PatientListItem[] | null>(null);

  const doctors = useDoctors("").data ?? [];
  const nextId = useNextPatientId(isNew);
  const form = useForm<FormValues, unknown, FormOutput>({
    resolver: zodResolver(formSchema),
    defaultValues: toFormValues(patient),
  });
  const { errors } = form.formState;
  const [{ display, integration }] = useRegistrationSettings();
  const splitName = display.nameLayout === "split";
  // First / middle / last are typed separately and joined into the single stored name.
  const [nameParts, setNameParts] = useState(() => {
    const w = (patient?.name ?? "").trim().split(/\s+/).filter(Boolean);
    if (w.length <= 1) return { first: w[0] ?? "", middle: "", last: "" };
    return { first: w[0], middle: w.slice(1, -1).join(" "), last: w[w.length - 1] };
  });
  // Ignore required-field choices saved for fields that no longer exist (MRN, National ID).
  const required = new Set(display.requiredFields.filter((k) => REQUIRED_FIELD_OPTIONS.some((o) => o.key === k)));
  // The barcode is typed in at registration only when the lab has switched off auto-generation.
  const hidden = new Set(integration.autoGenerateBarcode ? [...display.hiddenFields, "barcode"] : display.hiddenFields);
  const shown = (k: string) => !hidden.has(k);
  const L = (k: string, fallback: string) => display.fieldLabels[k]?.trim() || fallback;
  const [lastNameMissing, setLastNameMissing] = useState(false);
  const star = (k: string) => (required.has(k) ? <span className="text-destructive"> *</span> : null);
  // Checks the fields this lab marked as required; returns true when any is empty.
  const flagMissing = (values: Record<string, unknown>) => {
    let missing = false;
    for (const k of required) {
      if (hidden.has(k)) continue;
      if (k === "lastName") {
        if (splitName && !nameParts.last.trim()) { setLastNameMissing(true); missing = true; }
        continue;
      }
      const v = values[k];
      if (v == null || String(v).trim() === "") {
        form.setError(k as keyof FormValues, { type: "required", message: "This field is required" });
        missing = true;
      }
    }
    return missing;
  };
  function setNamePart(key: "first" | "middle" | "last", value: string) {
    if (key === "last") setLastNameMissing(false);
    const next = { ...nameParts, [key]: value };
    setNameParts(next);
    const full = [next.first, next.middle, next.last].map((x) => x.trim()).filter(Boolean).join(" ");
    form.setValue("name", full, { shouldDirty: true, shouldValidate: form.formState.isSubmitted });
  }
  const [phone, dob, age, sex] = useWatch({ control: form.control, name: ["phone", "dob", "age", "sex"] });
  const normalizedPhone = phone ? normalizeIndianMobile(phone) : null;

  const save = useMutation({
    mutationFn: ({ values, allowDuplicate }: { values: FormOutput; allowDuplicate?: boolean }) => {
      const { consent, ...body } = values;
      // The API takes either a dob or an age; send what the form shows.
      const payload = { ...body, dob: body.dobEstimated ? null : body.dob, age: body.dobEstimated ? form.getValues("age") : null };
      return isNew
        ? api<{ patient: PatientDetail }>("/patients", { method: "POST", body: { ...payload, consent, allowDuplicate } })
        : api<{ patient: PatientDetail }>(`/patients/${patient.id}`, { method: "PUT", body: payload });
    },
    onSuccess: async ({ patient: saved }) => {
      setDuplicates(null);
      queryClient.setQueryData(patientKeys.detail(saved.id), saved);
      await queryClient.invalidateQueries({ queryKey: patientKeys.all });
      onSaved(saved, { bill: billAfter.current });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === "possible_duplicate") {
        setDuplicates((err.details as DuplicatePatientDetails).candidates);
        return;
      }
      showFormError(err, form.setError);
    },
  });

  const onSubmit = form.handleSubmit(
    (values) => {
      if (flagMissing(values as Record<string, unknown>)) return;
      save.mutate({ values });
    },
    () => { flagMissing(form.getValues() as Record<string, unknown>); },
  );

  const submit = (bill: boolean) => {
    billAfter.current = bill;
    void onSubmit();
  };

  const setDobParts = (next: { y: string; m: string; d: string }) => {
    setParts(next);
    const y = Number(next.y), m = Number(next.m), d = Number(next.d);
    if (!y || !m || !d) return;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCMonth() !== m - 1) return; // e.g. 31 Feb
    const iso = `${next.y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    form.setValue("dob", iso, { shouldValidate: true, shouldDirty: true });
    form.setValue("age", null);
    const a = ageOn(iso);
    setAgeUnit(a.years > 0 ? "years" : a.months > 0 ? "months" : "days");
  };
  const setAge = (value: number | null, unit: "years" | "months" | "days") => {
    setAgeUnit(unit);
    setParts({ y: "", m: "", d: "" });
    form.setValue("dob", null);
    form.setValue("age", { years: 0, months: 0, days: 0, [unit]: value ?? 0 }, { shouldValidate: true, shouldDirty: true });
  };
  const clearDob = () => {
    setParts({ y: "", m: "", d: "" });
    form.setValue("dob", null);
    form.setValue("age", { years: 0, months: 0, days: 0 });
  };
  const ageValue = age ? age[ageUnit] || null : dob && dob <= todayIST() ? ageOn(dob)[ageUnit] : null;
  const thisYear = Number(todayIST().slice(0, 4));
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const dobError = errors.dob?.message ?? errors.age?.message;
  const radio = (name: string, value: string, current: string | null | undefined, onPick: (v: string) => void) => (
    <label className={cn("flex items-center gap-1.5 text-sm font-normal", phoneLocked && "text-muted-foreground")}>
      <input type="radio" name={name} checked={current === value} disabled={phoneLocked} onChange={() => onPick(value)} className="size-3.5 accent-primary" />
      {value}
    </label>
  );

  return (
    <>
      <form onSubmit={(e) => { e.preventDefault(); submit(false); }} noValidate className="flex flex-col gap-5 pb-20">
        <div className="grid gap-x-5 gap-y-4 md:grid-cols-4">
          <Field>
            <FieldLabel>Patient ID</FieldLabel>
            <div className="flex h-9 items-center rounded-lg border bg-muted/50 px-3 font-mono text-sm font-semibold tracking-wider" aria-live="polite">
              {patient ? patient.uhid : nextId.data ?? "…"}
            </div>
          </Field>
          {shown("patientType") && (
<Field>
            <FieldLabel>{L("patientType", "Select Patient Type")}{star("patientType")}</FieldLabel>
            <Controller
              control={form.control}
              name="patientType"
              render={({ field }) => (
                <Select value={field.value || NO_TITLE} onValueChange={(v) => field.onChange(v === NO_TITLE ? "" : v)}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Patient Type" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_TITLE}>—</SelectItem>
                    {["Regular", "VIP", "Staff", "Senior Citizen"].map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <FieldError errors={[errors.patientType]} />
          </Field>
)}
        </div>

        <div className={cn("grid gap-x-5 gap-y-4", shown("salutation") ? (splitName ? "md:grid-cols-[10rem_1fr_1fr_1fr]" : "md:grid-cols-[10rem_1fr]") : splitName ? "md:grid-cols-3" : "md:grid-cols-1")}>
          {shown("salutation") && (
<Field>
            <FieldLabel htmlFor="salutation">{L("salutation", "Designation")}</FieldLabel>
            <Controller
              control={form.control}
              name="salutation"
              render={({ field }) => (
                <Select
                  value={field.value ?? NO_TITLE}
                  onValueChange={(v) => {
                    const next = v === NO_TITLE ? null : (v as FormValues["salutation"]);
                    field.onChange(next);
                    // Mr / Mrs / Ms / Master imply the sex; switch it every time the title changes.
                    const implied = SALUTATIONS.find((s) => s.key === next)?.sex;
                    if (implied) form.setValue("sex", implied, { shouldValidate: true, shouldDirty: true });
                  }}
                >
                  <SelectTrigger id="salutation" className="w-full"><SelectValue placeholder="Designation" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_TITLE}>—</SelectItem>
                    {SALUTATIONS.map((s) => (
                      <SelectItem key={s.key} value={s.key}>{s.key}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
)}
          {splitName ? (
            <>
              <Field data-invalid={!!errors.name}>
                <FieldLabel htmlFor="firstName">First Name <span className="text-destructive">*</span></FieldLabel>
                <Input id="firstName" autoComplete="off" placeholder="First Name" autoFocus={isNew} aria-invalid={!!errors.name} value={nameParts.first} onChange={(e) => setNamePart("first", e.target.value)} />
                <FieldError errors={[errors.name]} />
              </Field>
              <Field>
                <FieldLabel htmlFor="middleName">Middle Name</FieldLabel>
                <Input id="middleName" autoComplete="off" placeholder="Middle Name" value={nameParts.middle} onChange={(e) => setNamePart("middle", e.target.value)} />
              </Field>
              <Field>
                <FieldLabel htmlFor="lastName">Last Name{star("lastName")}</FieldLabel>
                <Input id="lastName" autoComplete="off" placeholder="Last Name" aria-invalid={lastNameMissing} value={nameParts.last} onChange={(e) => setNamePart("last", e.target.value)} />
                {lastNameMissing && <p className="text-sm text-destructive">This field is required</p>}
              </Field>
            </>
          ) : (
            <Field data-invalid={!!errors.name}>
              <FieldLabel htmlFor="name">{L("name", "Enter Patient Name")} <span className="text-destructive">*</span></FieldLabel>
              <Input id="name" autoComplete="off" placeholder="Enter Patient Name" autoFocus={isNew} aria-invalid={!!errors.name} {...form.register("name")} />
              <FieldError errors={[errors.name]} />
            </Field>
          )}
        </div>

        <Field data-invalid={!!errors.sex} className="gap-1.5">
          <Label id="sex-label">{L("sex", "Gender")} <span className="text-destructive">*</span></Label>
          <div role="radiogroup" aria-labelledby="sex-label" className="flex h-9 items-center gap-5">
            {PATIENT_SEXES.map((s) => (
              <label key={s} className="flex items-center gap-1.5 text-sm font-normal">
                <input
                  type="radio"
                  name="sex"
                  checked={sex === s}
                  onChange={() => form.setValue("sex", s, { shouldValidate: true, shouldDirty: true })}
                  className="size-3.5 accent-primary"
                />
                {SEX_LABEL[s]}
              </label>
            ))}
          </div>
          <FieldError errors={[errors.sex]} />
        </Field>

        <div className="grid items-start gap-x-5 gap-y-4 md:grid-cols-2">
          <Field data-invalid={!!dobError}>
            <FieldLabel>{L("age", "Date of Birth")}</FieldLabel>
            <div className="grid grid-cols-3 gap-2">
              <Select value={parts.d} onValueChange={(v) => setDobParts({ ...parts, d: v })}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Day" /></SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 31 }, (_, i) => <SelectItem key={i} value={String(i + 1)}>{i + 1}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={parts.m} onValueChange={(v) => setDobParts({ ...parts, m: v })}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Month" /></SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={parts.y} onValueChange={(v) => setDobParts({ ...parts, y: v })}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Year" /></SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 121 }, (_, i) => thisYear - i).map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <button type="button" onClick={clearDob} className="w-fit text-sm text-primary hover:underline">Clear</button>
          </Field>
          <div className="grid grid-cols-2 gap-x-5 gap-y-4">
            <Field data-invalid={!!dobError}>
              <FieldLabel>Age <span className="text-destructive">*</span></FieldLabel>
              <NumberInput
                aria-label="Age"
                placeholder="Age"
                aria-invalid={!!dobError}
                value={ageValue}
                onChange={(v) => setAge(v == null ? null : Math.round(v), ageUnit)}
              />
              {dobError && <FieldError>{dobError}</FieldError>}
            </Field>
            <Field>
              <FieldLabel>&nbsp;</FieldLabel>
              <Select value={ageUnit} onValueChange={(v) => setAge(ageValue, v as "years" | "months" | "days")}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="years">Years</SelectItem>
                  <SelectItem value="months">Months</SelectItem>
                  <SelectItem value="days">Days</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
        </div>

        <div className="grid gap-x-5 gap-y-4 md:grid-cols-2">
          {shown("phone") && (
<Field data-invalid={!!errors.phone}>
            <FieldLabel htmlFor="phone">{L("phone", "Contact Number")}{star("phone")}</FieldLabel>
            <div className="flex">
              <span className="flex items-center rounded-l-md border border-r-0 px-3 text-sm text-muted-foreground">+91</span>
              <Input
                id="phone"
                type="tel"
                inputMode="tel"
                autoComplete="off"
                placeholder="81234 56789"
                className="rounded-l-none"
                readOnly={phoneLocked}
                aria-invalid={!!errors.phone}
                {...form.register("phone")}
              />
            </div>
            <FieldError errors={[errors.phone]} />
            {phoneLocked && (
              <button type="button" onClick={() => setPhoneLocked(false)} className="w-fit self-end text-sm text-primary hover:underline">
                Update Mobile Number
              </button>
            )}
          </Field>
)}
          {shown("phoneBelongsTo") && (
<Field>
            <FieldLabel>{L("phoneBelongsTo", "Phone Number Belongs To")}</FieldLabel>
            <Controller
              control={form.control}
              name="phoneBelongsTo"
              render={({ field }) => (
                <div className="flex gap-4 pt-1">
                  {radio("belongs", "Patient", field.value, field.onChange)}
                  {radio("belongs", "Relative/Guardian", field.value, field.onChange)}
                </div>
              )}
            />
          </Field>
)}
        </div>
        {isNew && <SameNumberPatients phone={normalizedPhone} />}

        <div className="grid gap-x-5 gap-y-4 md:grid-cols-2">
        {shown("email") && (
<Field data-invalid={!!errors.email}>
          <FieldLabel htmlFor="email">{L("email", "Email")}{star("email")}</FieldLabel>
          <Input id="email" type="email" placeholder="Email" aria-invalid={!!errors.email} {...form.register("email")} />
          <FieldError errors={[errors.email]} />
        </Field>
)}
          {shown("referral") && (
<Field>
            <FieldLabel htmlFor="referral">{L("referral", "Referral")}{star("referral")}</FieldLabel>
            <Controller
              control={form.control}
              name="referral"
              render={({ field }) => (
                <DoctorPicker
                  id="referral"
                  noneLabel="SELF"
                  value={doctors.find((d) => d.name === field.value) ?? null}
                  fallbackLabel={field.value && field.value !== "SELF" ? field.value : undefined}
                  onChange={(d) => field.onChange(d ? d.name : "SELF")}
                />
              )}
            />
            <FieldError errors={[errors.referral]} />
          </Field>
)}
        </div>

        {shown("address") && (
<Field>
          <FieldLabel htmlFor="address">{L("address", "Address")}{star("address")}</FieldLabel>
          <Input id="address" placeholder="Address" {...form.register("address")} />
          <FieldError errors={[errors.address]} />
        </Field>
)}

        <div className="grid gap-x-5 gap-y-4 md:grid-cols-2">
          {shown("city") && (
<Field>
            <FieldLabel htmlFor="city">{L("city", "City")}{star("city")}</FieldLabel>
            <Input id="city" placeholder="City" {...form.register("city")} />
            <FieldError errors={[errors.city]} />
          </Field>
)}
          {shown("state") && (
<Field>
            <FieldLabel htmlFor="state">{L("state", "State")}{star("state")}</FieldLabel>
            <Input id="state" placeholder="State" {...form.register("state")} />
            <FieldError errors={[errors.state]} />
          </Field>
)}
          {shown("district") && (
<Field>
            <FieldLabel htmlFor="district">{L("district", "District")}{star("district")}</FieldLabel>
            <Input id="district" placeholder="District" {...form.register("district")} />
            <FieldError errors={[errors.district]} />
          </Field>
)}
          {shown("pincode") && (
<Field data-invalid={!!errors.pincode}>
            <FieldLabel htmlFor="pincode">{L("pincode", "Pincode")}{star("pincode")}</FieldLabel>
            <Input id="pincode" inputMode="numeric" maxLength={6} placeholder="Pincode" aria-invalid={!!errors.pincode} {...form.register("pincode")} />
            <FieldError errors={[errors.pincode]} />
          </Field>
)}
          {shown("passportNumber") && (
<Field>
            <FieldLabel htmlFor="passportNumber">{L("passportNumber", "Passport Number")}{star("passportNumber")}</FieldLabel>
            <Input id="passportNumber" placeholder="Passport Number" {...form.register("passportNumber")} />
            <FieldError errors={[errors.passportNumber]} />
          </Field>
)}
        </div>
        <div className="grid gap-x-5 gap-y-4 md:grid-cols-2">
        {shown("barcode") && (
<Field>
          <FieldLabel htmlFor="barcode">{L("barcode", "Barcode No.")}{star("barcode")}</FieldLabel>
          <Input id="barcode" placeholder="Scan or type the barcode" {...form.register("barcode")} />
          <FieldError errors={[errors.barcode]} />
        </Field>
)}
        {shown("country") && (
<Field>
          <FieldLabel htmlFor="country">{L("country", "Country")}{star("country")}</FieldLabel>
          <Input id="country" placeholder="Select Country" {...form.register("country")} />
          <FieldError errors={[errors.country]} />
        </Field>
)}
        </div>

        <div
          className={cn(
            "sticky bottom-0 -mx-4 flex items-center justify-between gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6",
          )}
        >
          {onCancel ? (
            <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                form.reset(toFormValues());
                clearDob();
              }}
            >
              Clear
            </Button>
          )}
          <div className="flex items-center gap-2">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Spinner />}
              {isNew ? "Register" : "Save changes"}
            </Button>
            {isNew && (
              <Button type="button" disabled={save.isPending} onClick={() => submit(true)}>
                Register And Bill
              </Button>
            )}
          </div>
        </div>
      </form>

      <DuplicateDialog
        candidates={duplicates}
        pending={save.isPending}
        onClose={() => setDuplicates(null)}
        onRegisterAnyway={() => {
          const values = formSchema.safeParse(form.getValues());
          if (values.success) save.mutate({ values: values.data, allowDuplicate: true });
        }}
      />
    </>
  );
}

export function useRegisteredToast() {
  return (p: PatientDetail) => toast.success(`Registered ${patientDisplayName(p)} as ${p.uhid}`);
}
