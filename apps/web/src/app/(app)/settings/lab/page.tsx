"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PencilIcon, PlusIcon } from "lucide-react";
import { branchSchema, labProfileSchema, type BranchItem, type LabProfile } from "@lms/shared";
import type { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { PageHeader } from "@/components/app-shell/page-header";
import { useAuth } from "@/providers/auth-provider";
import { ImageField } from "@/components/branding/image-field";
import { api, apiUpload } from "@/lib/api";
import { APP_NAME } from "@/lib/brand";
import { cn } from "@/lib/utils";
import { showFormError } from "@/lib/forms";
import { orderKeys, useLab } from "@/lib/orders";
import { useWhatsappSettings } from "@/lib/reports";
import { WhatsappCard } from "./whatsapp-card";
import { ReportDetails } from "./report-details";
import { BillDetails } from "./bill-details";
import { DoctorDetails } from "./doctor-details";

type ProfileValues = z.input<typeof labProfileSchema>;
type BranchValues = z.input<typeof branchSchema>;

const profileValues = (lab: LabProfile): ProfileValues => ({
  name: lab.name,
  tagline: lab.tagline ?? "",
  gstin: lab.gstin ?? "",
  phone: lab.phone ?? "",
  email: lab.email ?? "",
  website: lab.website ?? "",
  address: lab.address ?? "",
  accreditation: lab.accreditation ?? "",
});

function ProfileForm({ lab }: { lab: LabProfile }) {
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const form = useForm<ProfileValues, unknown, z.output<typeof labProfileSchema>>({
    resolver: zodResolver(labProfileSchema),
    defaultValues: profileValues(lab),
  });
  const { errors, isDirty } = form.formState;

  const save = useMutation({
    mutationFn: (values: z.output<typeof labProfileSchema>) => api<{ lab: LabProfile }>("/lab", { method: "PUT", body: values }),
    onSuccess: ({ lab: saved }) => {
      queryClient.setQueryData(orderKeys.lab, saved);
      form.reset(profileValues(saved));
      toast.success("Saved");
    },
    onError: (err) => showFormError(err, form.setError),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Lab details</CardTitle>
        <CardDescription>Printed at the top of bills and reports.</CardDescription>
      </CardHeader>
      <CardContent>
        <form noValidate onSubmit={form.handleSubmit((v) => save.mutate(v))}>
          <fieldset disabled={!can("settings:write")} className="contents">
            <FieldGroup className="grid gap-4 sm:grid-cols-2">
              <Field data-invalid={!!errors.name} className="sm:col-span-2">
                <FieldLabel htmlFor="lab-name">Lab name</FieldLabel>
                <Input id="lab-name" aria-invalid={!!errors.name} {...form.register("name")} />
                <FieldError errors={[errors.name]} />
              </Field>
              <Field data-invalid={!!errors.tagline} className="sm:col-span-2">
                <FieldLabel htmlFor="lab-tagline">Tagline</FieldLabel>
                <Input id="lab-tagline" placeholder="Accurate diagnostics since 2009" aria-invalid={!!errors.tagline} {...form.register("tagline")} />
                <FieldError errors={[errors.tagline]} />
              </Field>
              <Field data-invalid={!!errors.address} className="sm:col-span-2">
                <FieldLabel htmlFor="lab-address">Address</FieldLabel>
                <Input id="lab-address" aria-invalid={!!errors.address} {...form.register("address")} />
                <FieldDescription>Used on reports when the branch has no address of its own.</FieldDescription>
                <FieldError errors={[errors.address]} />
              </Field>
              <Field data-invalid={!!errors.gstin}>
                <FieldLabel htmlFor="gstin">GSTIN</FieldLabel>
                <Input id="gstin" className="uppercase" maxLength={15} placeholder="27ABCDE1234F1Z5" aria-invalid={!!errors.gstin} {...form.register("gstin")} />
                {errors.gstin ? <FieldError errors={[errors.gstin]} /> : <FieldDescription>Leave empty if not registered.</FieldDescription>}
              </Field>
              <Field data-invalid={!!errors.phone}>
                <FieldLabel htmlFor="lab-phone">Phone</FieldLabel>
                <Input id="lab-phone" type="tel" aria-invalid={!!errors.phone} {...form.register("phone")} />
                <FieldError errors={[errors.phone]} />
              </Field>
              <Field data-invalid={!!errors.email}>
                <FieldLabel htmlFor="lab-email">Email</FieldLabel>
                <Input id="lab-email" type="email" aria-invalid={!!errors.email} {...form.register("email")} />
                <FieldError errors={[errors.email]} />
              </Field>
              <Field data-invalid={!!errors.website}>
                <FieldLabel htmlFor="lab-website">Website</FieldLabel>
                <Input id="lab-website" inputMode="url" placeholder="www.yourlab.in" aria-invalid={!!errors.website} {...form.register("website")} />
                <FieldError errors={[errors.website]} />
              </Field>
              <Field data-invalid={!!errors.accreditation} className="sm:col-span-2">
                <FieldLabel htmlFor="lab-accreditation">Accreditation</FieldLabel>
                <Input id="lab-accreditation" placeholder="NABL accredited · MC-1234" aria-invalid={!!errors.accreditation} {...form.register("accreditation")} />
                <FieldDescription>Printed at the top right of reports.</FieldDescription>
                <FieldError errors={[errors.accreditation]} />
              </Field>
            </FieldGroup>
            {can("settings:write") && (
              <div className="mt-4 flex justify-end">
                <Button type="submit" disabled={!isDirty || save.isPending}>
                  {save.isPending && <Spinner />}
                  Save
                </Button>
              </div>
            )}
          </fieldset>
        </form>
      </CardContent>
    </Card>
  );
}

function BrandingCard({ lab }: { lab: LabProfile }) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: orderKeys.lab });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Logo</CardTitle>
        <CardDescription>Your logo shows in the app and on reports.</CardDescription>
      </CardHeader>
      <CardContent>
        <ImageField
          kind="LOGO"
          label="Logo"
          description="A PNG with a transparent background looks best."
          assetId={lab.logoId}
          previewClassName="h-24"
          onUpload={(file) => apiUpload("/lab/logo", file).then(refresh)}
          onRemove={() => api("/lab/logo", { method: "DELETE" }).then(refresh)}
        />
      </CardContent>
    </Card>
  );
}

const TABS = [
  { id: "lab", label: "Lab Details" },
  { id: "report", label: "Report Details" },
  { id: "bill", label: "Bill Details" },
  { id: "doctor", label: "Doctor Details" },
] as const;
type TabId = (typeof TABS)[number]["id"];

function BranchDialog({ branch, open, onOpenChange }: { branch: BranchItem | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const queryClient = useQueryClient();
  const { refreshUser } = useAuth();
  const form = useForm<BranchValues, unknown, z.output<typeof branchSchema>>({
    resolver: zodResolver(branchSchema),
    defaultValues: branch
      ? { name: branch.name, code: branch.code, type: branch.type, address: branch.address ?? "", phone: branch.phone ?? "" }
      : { name: "", code: "", type: "COLLECTION_CENTRE", address: "", phone: "" },
  });
  const { errors } = form.formState;

  const save = useMutation({
    mutationFn: (values: z.output<typeof branchSchema>) =>
      branch ? api(`/lab/branches/${branch.id}`, { method: "PUT", body: values }) : api("/lab/branches", { method: "POST", body: values }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: orderKeys.lab });
      await refreshUser(); // so a new branch shows in the branch switcher
      toast.success(branch ? "Saved" : "Branch added");
      onOpenChange(false);
    },
    onError: (err) => showFormError(err, form.setError),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form noValidate className="grid gap-5" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
          <DialogHeader>
            <DialogTitle>{branch ? `Edit ${branch.name}` : "Add a branch"}</DialogTitle>
            <DialogDescription>The address and phone print on bills from this branch.</DialogDescription>
          </DialogHeader>
          <FieldGroup className="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <Field data-invalid={!!errors.name}>
              <FieldLabel htmlFor="b-name">Name</FieldLabel>
              <Input id="b-name" aria-invalid={!!errors.name} {...form.register("name")} />
              <FieldError errors={[errors.name]} />
            </Field>
            <Field data-invalid={!!errors.code}>
              <FieldLabel htmlFor="b-code">Code</FieldLabel>
              <Input id="b-code" className="uppercase" maxLength={8} aria-invalid={!!errors.code} {...form.register("code")} />
              <FieldError errors={[errors.code]} />
            </Field>
            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="b-type">Type</FieldLabel>
              <Controller
                control={form.control}
                name="type"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="b-type" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="LAB">Processing lab</SelectItem>
                      <SelectItem value="COLLECTION_CENTRE">Collection centre</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="b-address">Address</FieldLabel>
              <Input id="b-address" {...form.register("address")} />
            </Field>
            <Field data-invalid={!!errors.phone} className="sm:col-span-2">
              <FieldLabel htmlFor="b-phone">Phone</FieldLabel>
              <Input id="b-phone" type="tel" aria-invalid={!!errors.phone} {...form.register("phone")} />
              <FieldError errors={[errors.phone]} />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Spinner />}
              {branch ? "Save" : "Add branch"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function LabSettingsPage() {
  const { can } = useAuth();
  const { data: lab, isPending } = useLab();
  const whatsapp = useWhatsappSettings(can("settings:write"));
  const [tab, setTab] = useState<TabId>("lab");
  const [dialog, setDialog] = useState<{ open: boolean; branch: BranchItem | null; n: number }>({ open: false, branch: null, n: 0 });
  const openDialog = (branch: BranchItem | null) => setDialog((d) => ({ open: true, branch, n: d.n + 1 }));

  return (
    <>
      <title>{`Lab profile · ${APP_NAME}`}</title>
      <PageHeader title="Lab profile" description="Your lab's details, branches and report delivery." />
      {isPending || !lab ? (
        <Skeleton className="h-64 w-full max-w-3xl" />
      ) : (
        <div className="space-y-6">
          <div role="tablist" className="flex gap-6 border-b">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "-mb-px border-b-2 pb-2 text-sm font-medium transition-colors",
                  tab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          {tab === "report" ? (
            <ReportDetails />
          ) : tab === "bill" ? (
            <BillDetails />
          ) : tab === "doctor" ? (
            <DoctorDetails />
          ) : (
            <div className="space-y-6">
          <ProfileForm lab={lab} />
          <BrandingCard lab={lab} />
          {whatsapp.data && <WhatsappCard settings={whatsapp.data} />}
          <Card>
            <CardHeader>
              <CardTitle>Branches</CardTitle>
              <CardDescription>Your processing lab and collection centres.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <ul className="divide-y rounded-lg border">
                {lab.branches.map((b) => (
                  <li key={b.id} className="flex items-start gap-3 px-3 py-2.5 text-sm">
                    <div className="flex-1">
                      <div className="font-medium">
                        {b.name} <span className="font-mono text-xs text-muted-foreground">{b.code}</span>{" "}
                        <Badge variant="secondary">{b.type === "LAB" ? "Lab" : "Collection centre"}</Badge>
                      </div>
                      <div className="text-muted-foreground">{[b.address, b.phone].filter(Boolean).join(" · ") || "No address yet"}</div>
                    </div>
                    {can("branches:write") && (
                      <Button variant="ghost" size="sm" onClick={() => openDialog(b)}>
                        <PencilIcon /> Edit
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
              {can("branches:write") && (
                <Button variant="outline" onClick={() => openDialog(null)}>
                  <PlusIcon /> Add branch
                </Button>
              )}
            </CardContent>
          </Card>
            </div>
          )}
        </div>
      )}
      <BranchDialog key={dialog.n} branch={dialog.branch} open={dialog.open} onOpenChange={(open) => setDialog((d) => ({ ...d, open }))} />
    </>
  );
}
