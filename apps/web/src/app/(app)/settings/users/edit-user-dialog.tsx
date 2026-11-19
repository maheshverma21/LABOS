"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { updateUserSchema, type AssetInfo, type UserListItem } from "@lms/shared";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ImageField } from "@/components/branding/image-field";
import { api, apiUpload } from "@/lib/api";
import { showFormError } from "@/lib/forms";

type Values = z.input<typeof updateUserSchema>;

export function EditUserDialog({ user, onOpenChange }: { user: UserListItem; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const signs = user.roles.some((r) => r.key === "pathologist");
  const form = useForm<Values, unknown, z.output<typeof updateUserSchema>>({
    resolver: zodResolver(updateUserSchema),
    defaultValues: {
      name: user.name,
      phone: user.phone ?? "",
      qualification: user.qualification ?? "",
      registrationNo: user.registrationNo ?? "",
    },
  });
  const { errors } = form.formState;
  // The dialog gets a snapshot of the user, so the images it shows are tracked here.
  const [images, setImages] = useState({ signature: user.signatureId, stamp: user.stampId });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["users"] });
  const uploadImage = (slug: "signature" | "stamp") => async (file: Blob) => {
    const { asset } = await apiUpload<{ asset: AssetInfo }>(`/users/${user.id}/${slug}`, file);
    setImages((i) => ({ ...i, [slug]: asset.id }));
    await refresh();
  };
  const removeImage = (slug: "signature" | "stamp") => async () => {
    await api(`/users/${user.id}/${slug}`, { method: "DELETE" });
    setImages((i) => ({ ...i, [slug]: null }));
    await refresh();
  };

  const save = useMutation({
    mutationFn: (values: z.output<typeof updateUserSchema>) => api(`/users/${user.id}`, { method: "PATCH", body: values }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success("Saved");
      onOpenChange(false);
    },
    onError: (err) => showFormError(err, form.setError),
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <form noValidate className="grid gap-5" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
          <DialogHeader>
            <DialogTitle>Edit {user.name}</DialogTitle>
            <DialogDescription>{user.email}</DialogDescription>
          </DialogHeader>
          <FieldGroup className="grid gap-4">
            <Field data-invalid={!!errors.name}>
              <FieldLabel htmlFor="u-name">Name</FieldLabel>
              <Input id="u-name" aria-invalid={!!errors.name} {...form.register("name")} />
              <FieldError errors={[errors.name]} />
            </Field>
            <Field data-invalid={!!errors.phone}>
              <FieldLabel htmlFor="u-phone">Mobile</FieldLabel>
              <Input id="u-phone" inputMode="tel" aria-invalid={!!errors.phone} {...form.register("phone")} />
              <FieldError errors={[errors.phone]} />
            </Field>
            <Field data-invalid={!!errors.qualification}>
              <FieldLabel htmlFor="u-qual">Qualification</FieldLabel>
              <Input id="u-qual" placeholder="MD (Pathology)" {...form.register("qualification")} />
              <FieldDescription>
                {signs ? "Printed under the signature on reports this person approves." : "Only printed for pathologists."}
              </FieldDescription>
              <FieldError errors={[errors.qualification]} />
            </Field>
            <Field data-invalid={!!errors.registrationNo}>
              <FieldLabel htmlFor="u-reg">Medical council registration no.</FieldLabel>
              <Input id="u-reg" placeholder="MMC 2011/04/1234" {...form.register("registrationNo")} />
              <FieldError errors={[errors.registrationNo]} />
            </Field>
            {signs && (
              <div className="grid gap-4 sm:grid-cols-2">
                <ImageField
                  kind="SIGNATURE"
                  label="Signature"
                  previewClassName="h-20"
                  assetId={images.signature}
                  onUpload={uploadImage("signature")}
                  onRemove={removeImage("signature")}
                />
                <ImageField
                  kind="STAMP"
                  label="Stamp"
                  previewClassName="h-20"
                  assetId={images.stamp}
                  onUpload={uploadImage("stamp")}
                  onRemove={removeImage("stamp")}
                />
              </div>
            )}
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Spinner />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
