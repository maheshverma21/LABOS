"use client";

import { Suspense, useDeferredValue, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BarcodeIcon, SearchIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { formatMobile, patientDisplayName } from "@lms/shared";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/providers/auth-provider";
import { PatientForm, useRegisteredToast } from "./_components/patient-form";
import { RegistrationSettingsButton } from "./_components/registration-settings-dialog";
import { APP_NAME } from "@/lib/brand";
import { ageSex, usePatient, usePatientSearch } from "@/lib/patients";

function UpdateExisting() {
  const router = useRouter();
  const params = useSearchParams();
  const selectedId = params.get("id") ?? "";
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const q = useDeferredValue(search.trim());
  const results = usePatientSearch(q, 1, 8);
  const selected = usePatient(selectedId);

  const proceed = () => {
    if (selectedId) router.push(`/orders/new?patientId=${selectedId}`);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") proceed();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const select = (id: string | null) => {
    setSearch("");
    setOpen(false);
    router.replace(id ? `/patients?tab=existing&id=${id}` : "/patients?tab=existing");
  };

  return (
    <>
      <div className="-mx-4 flex flex-wrap items-start gap-4 bg-muted/50 px-4 py-3 md:-mx-6 md:px-6">
        <div className="w-full sm:max-w-xl">
          <div className="relative">
            <InputGroup className="bg-background">
              <InputGroupAddon>
                <SearchIcon />
              </InputGroupAddon>
              <InputGroupInput
                autoFocus
                placeholder="Search By Name, Phone or Patient ID"
                aria-label="Search patients"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setOpen(true);
                }}
                onFocus={() => setOpen(true)}
              />
              <InputGroupAddon align="inline-end">
                {search && (
                  <button type="button" aria-label="Clear search" onClick={() => setSearch("")}>
                    <XIcon className="size-4" />
                  </button>
                )}
                <BarcodeIcon className="size-4" />
              </InputGroupAddon>
            </InputGroup>
            {open && q && (
              <ul className="absolute z-20 mt-1 max-h-80 w-full divide-y overflow-auto rounded-lg border bg-popover shadow-md">
                {results.data?.patients.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted"
                      onClick={() => select(p.id)}
                    >
                      <span className="w-20 font-mono text-xs text-muted-foreground">{p.uhid}</span>
                      <span className="flex-1 font-medium">{patientDisplayName(p)}</span>
                      <span className="text-muted-foreground">{ageSex(p)}</span>
                      <span className="hidden w-28 text-right tabular-nums text-muted-foreground sm:block">
                        {p.phone ? formatMobile(p.phone) : ""}
                      </span>
                    </button>
                  </li>
                ))}
                {results.data?.patients.length === 0 && !results.isFetching && (
                  <li className="px-3 py-3 text-sm text-muted-foreground">No patient matches &ldquo;{q}&rdquo;.</li>
                )}
              </ul>
            )}
          </div>
        </div>
        <div className="flex flex-col items-center">
          <Button disabled={!selected.data} onClick={proceed}>
            Proceed To Bill
          </Button>
          <span className="mt-1 text-[10px] italic text-muted-foreground">ctrl+enter</span>
        </div>
      </div>

      {!selectedId && <p className="py-10 text-center text-sm text-muted-foreground">Search for a patient to view and update their details.</p>}
      {selectedId && selected.isPending && <Skeleton className="h-64 w-full" />}
      {selected.data && (
        <PatientForm
          key={`${selected.data.id}-${selected.data.updatedAt}`}
          patient={selected.data}
          onSaved={(p) => toast.success(`Updated ${patientDisplayName(p)}`)}
          onCancel={() => select(null)}
        />
      )}
    </>
  );
}

function NewRegistration() {
  const router = useRouter();
  const registered = useRegisteredToast();
  const [formKey, setFormKey] = useState(0);
  return (
    <PatientForm
      key={formKey}
      onSaved={(p, opts) => {
        registered(p);
        if (opts?.bill) router.push(`/orders/new?patientId=${p.id}`);
        else setFormKey((k) => k + 1); // a fresh form for the next patient
      }}
    />
  );
}

function RegistrationBilling() {
  const { can } = useAuth();
  const params = useSearchParams();
  const router = useRouter();
  const tab = params.get("tab") === "existing" || !can("patients:write") ? "existing" : "new";
  const tabs = [
    ...(can("patients:write") ? [{ key: "new", label: "New Registration" }] : []),
    { key: "existing", label: "Update Existing" },
  ];
  return (
    <>
      <title>{`Registration / Billing · ${APP_NAME}`}</title>
      <div className="flex items-center gap-1 border-b">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => router.replace(t.key === "new" ? "/patients" : "/patients?tab=existing")}
            className={
              tab === t.key
                ? "-mb-px border-b-2 border-primary px-4 py-2 text-sm font-medium text-primary"
                : "-mb-px border-b-2 border-transparent px-4 py-2 text-sm hover:text-primary"
            }
          >
            {t.label}
          </button>
        ))}
        <div className="ml-auto py-1.5"><RegistrationSettingsButton /></div>
      </div>
      {tab === "new" ? <NewRegistration /> : <UpdateExisting />}
    </>
  );
}

export default function PatientsPage() {
  return (
    <Suspense>
      <RegistrationBilling />
    </Suspense>
  );
}
