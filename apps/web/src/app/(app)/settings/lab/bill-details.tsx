"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BILL_SIZES, type BillSettings, type BillSize } from "@lms/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { brandingKeys, useBillSettings } from "@/lib/branding";
import { useAuth } from "@/providers/auth-provider";
import { ImageUpload } from "./report-details";

function BillForm({ settings }: { settings: BillSettings }) {
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const editable = can("settings:write");
  const [custom, setCustom] = useState(settings.custom);
  const [heading, setHeading] = useState(settings.heading);
  const [size, setSize] = useState<BillSize>(settings.size);
  const [headerId, setHeaderId] = useState(settings.headerImageId);
  const [footerId, setFooterId] = useState(settings.footerImageId);
  const [headerH, setHeaderH] = useState(String(settings.headerHeightMm));
  const [footerH, setFooterH] = useState(String(settings.footerHeightMm));

  const hh = Number(headerH);
  const fh = Number(footerH);
  const headingError = heading.trim() ? null : "Enter a heading";
  const headerError = !Number.isInteger(hh) || hh < 0 || hh > 150 ? "Enter 0 to 150 mm" : null;
  const footerError = !Number.isInteger(fh) || fh < 0 || fh > 150 ? "Enter 0 to 150 mm" : null;
  const invalid = !!headingError || !!headerError || !!footerError;
  const dirty =
    custom !== settings.custom ||
    heading !== settings.heading ||
    size !== settings.size ||
    headerId !== settings.headerImageId ||
    footerId !== settings.footerImageId ||
    hh !== settings.headerHeightMm ||
    fh !== settings.footerHeightMm;

  const save = useMutation({
    mutationFn: () =>
      api("/lab/bill-settings", {
        method: "PUT",
        body: { custom, heading: heading.trim(), size, headerImageId: headerId, footerImageId: footerId, headerHeightMm: hh, footerHeightMm: fh },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: brandingKeys.bill });
      toast.success("Saved");
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="border-b">
          <CardTitle>Bill Template</CardTitle>
        </CardHeader>
        <CardContent>
          <label className="flex items-center gap-3 text-sm">
            <span className={custom ? "text-muted-foreground" : "font-medium"}>Default</span>
            <Switch checked={custom} onCheckedChange={setCustom} disabled={!editable} aria-label="Use a custom bill template" />
            <span className={custom ? "font-medium" : "text-muted-foreground"}>Custom</span>
          </label>
          <p className="mt-2 text-xs text-muted-foreground">
            Default prints bills with your report letterhead. Custom uses the heading, header, footer and size below, whatever the report background is.
          </p>
        </CardContent>
      </Card>

      <Card className={custom ? undefined : "opacity-60"}>
        <CardHeader className="border-b">
          <CardTitle>Bill Layout</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6">
          <fieldset disabled={!custom || !editable} className="contents">
            <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
              <Field data-invalid={!!headingError} className="content-start">
                <FieldLabel htmlFor="bd-heading">Bill Heading</FieldLabel>
                <Input id="bd-heading" maxLength={60} value={heading} onChange={(e) => setHeading(e.target.value)} aria-invalid={!!headingError} />
                {headingError && <FieldError>{headingError}</FieldError>}
              </Field>
              <ImageUpload kind="HEADER" label="Bill Header" fileLabel="Bill Header" assetId={headerId} disabled={!custom || !editable} onChange={setHeaderId} />
              <ImageUpload kind="FOOTER" label="Bill Footer" fileLabel="Bill Footer" assetId={footerId} disabled={!custom || !editable} onChange={setFooterId} />
            </div>
            <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
              <div className="grid content-start gap-2" role="radiogroup" aria-label="Bill Size">
                <span className="text-sm font-medium">Bill Size</span>
                <div className="flex gap-6 pt-1">
                  {BILL_SIZES.map((s) => (
                    <label key={s} className="flex cursor-pointer items-center gap-2 text-sm">
                      <input type="radio" name="bill-size" className="size-4 accent-primary" checked={size === s} onChange={() => setSize(s)} />
                      {s}
                    </label>
                  ))}
                </div>
              </div>
              <Field data-invalid={!!headerError}>
                <FieldLabel htmlFor="bd-hh">Header Height (mm)</FieldLabel>
                <Input id="bd-hh" type="number" inputMode="numeric" min={0} max={150} value={headerH} onChange={(e) => setHeaderH(e.target.value)} aria-invalid={!!headerError} />
                {headerError && <FieldError>{headerError}</FieldError>}
              </Field>
              <Field data-invalid={!!footerError}>
                <FieldLabel htmlFor="bd-fh">Footer Height (mm)</FieldLabel>
                <Input id="bd-fh" type="number" inputMode="numeric" min={0} max={150} value={footerH} onChange={(e) => setFooterH(e.target.value)} aria-invalid={!!footerError} />
                {footerError && <FieldError>{footerError}</FieldError>}
              </Field>
            </div>
          </fieldset>
          {editable && (
            <div className="flex justify-end">
              <Button disabled={!dirty || invalid || save.isPending} onClick={() => save.mutate()}>
                {save.isPending && <Spinner />}
                Save
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** The "Bill Details" tab: its own heading, header, footer and size for printed bills. */
export function BillDetails() {
  const { data, isPending, isPlaceholderData } = useBillSettings();
  if (isPending || isPlaceholderData || !data) return <Skeleton className="h-64 w-full" />;
  return <BillForm key={JSON.stringify(data)} settings={data} />;
}
