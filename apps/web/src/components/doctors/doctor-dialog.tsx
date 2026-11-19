"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { doctorSchema, type DoctorItem } from "@lms/shared";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api";
import { showFormError } from "@/lib/forms";

type FormValues = z.input<typeof doctorSchema>;

const blank: FormValues = { name: "", qualification: "", specialty: "", phone: "", clinicName: "", city: "", commissionPercent: "", priceListId: null };

export function DoctorDialog({ doctor, open, onOpenChange, initialName, onSaved }: { doctor: DoctorItem | null; open: boolean; onOpenChange: (o: boolean) => void; initialName?: string; onSaved?: (d: DoctorItem) => void }) {
  const queryClient = useQueryClient();
  const form = useForm<FormValues, unknown, z.output<typeof doctorSchema>>({
    resolver: zodResolver(doctorSchema),
    defaultValues: doctor
      ? {
          name: doctor.name,
          qualification: doctor.qualification ?? "",
          specialty: doctor.specialty ?? "",
          phone: doctor.phone ?? "",
          clinicName: doctor.clinicName ?? "",
          city: doctor.city ?? "",
          commissionPercent: doctor.commissionPercent ? String(doctor.commissionPercent) : "",
          priceListId: doctor.priceList?.id ?? null,
        }
      : { ...blank, name: initialName ?? "" },
  });
  const { errors } = form.formState;

  const save = useMutation({
    mutationFn: (values: z.output<typeof doctorSchema>) =>
      doctor
        ? api<{ doctor: DoctorItem }>(`/doctors/${doctor.id}`, { method: "PUT", body: values })
        : api<{ doctor: DoctorItem }>("/doctors", { method: "POST", body: values }),
    onSuccess: async (r, values) => {
      toast.success(doctor ? "Saved" : `Added ${values.name}`);
      await queryClient.invalidateQueries({ queryKey: ["doctors"] });
      onSaved?.(r.doctor);
      onOpenChange(false);
    },
    onError: (err) => showFormError(err, form.setError),
  });

  const text = (name: keyof FormValues, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <Field data-invalid={!!errors[name]}>
      <FieldLabel htmlFor={`doc-${name}`}>{label}</FieldLabel>
      <Input id={`doc-${name}`} aria-invalid={!!errors[name]} {...props} {...form.register(name)} />
      <FieldError errors={[errors[name]]} />
    </Field>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form noValidate className="grid gap-5" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
          <DialogHeader>
            <DialogTitle>{doctor ? "Edit doctor" : "Add referring doctor"}</DialogTitle>
            <DialogDescription>Picked when creating an order, and printed on the report. Commission is applied to the order when this doctor is selected.</DialogDescription>
          </DialogHeader>
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">{text("name", "Name", { placeholder: "Dr. A. K. Sharma", autoFocus: true })}</div>
            {text("qualification", "Qualification", { placeholder: "MBBS, MD" })}
            {text("specialty", "Specialty", { placeholder: "Physician" })}
            {text("clinicName", "Clinic / hospital")}
            {text("city", "City")}
            {text("phone", "Mobile", { type: "tel" })}
            {text("commissionPercent", "Commission (%)", { type: "number", inputMode: "decimal", min: 0, max: 100, step: "0.01", placeholder: "0" })}
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Spinner />}
              {doctor ? "Save" : "Add doctor"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

