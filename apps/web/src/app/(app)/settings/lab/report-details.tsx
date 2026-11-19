"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRightIcon, EyeIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { ASSET_MAX_BYTES, ASSET_MIME_TYPES, REPORT_FONTS, type AssetInfo, type AssetKind, type ReportFontId, type ReportTemplateItem } from "@lms/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { api, apiBlob, apiUpload } from "@/lib/api";
import { brandingKeys, cleanSignatureImage, shrinkImage, useAssetUrl, useTemplates } from "@/lib/branding";
import { useAuth } from "@/providers/auth-provider";

/** "Click to Upload" button, with the uploaded image shown below it and a bin to remove it. */
export function ImageUpload({
  kind,
  label,
  fileLabel,
  hint,
  cleanUp = false,
  assetId,
  disabled,
  onChange,
}: {
  hint?: string;
  kind: Extract<AssetKind, "HEADER" | "FOOTER" | "BACKGROUND" | "DOCTOR_SIGNATURE">;
  /** Turn the paper of a photographed signature transparent and trim it. */
  cleanUp?: boolean;
  label: string;
  fileLabel: string;
  assetId: string | null;
  disabled: boolean;
  onChange: (id: string | null) => void;
}) {
  const url = useAssetUrl(assetId);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function pick(file: File | undefined) {
    if (!file) return;
    if (!(ASSET_MIME_TYPES as readonly string[]).includes(file.type)) {
      toast.error("Use a PNG or JPEG image");
      return;
    }
    setBusy(true);
    try {
      const prepared = cleanUp ? await cleanSignatureImage(file, { maxSide: 1000 }) : await shrinkImage(file, kind === "BACKGROUND" ? 3508 : 2480);
      if (prepared.size > ASSET_MAX_BYTES[kind]) {
        throw new Error(`That image is still over ${Math.round(ASSET_MAX_BYTES[kind] / 1024)} KB after resizing. Try a smaller file.`);
      }
      const { asset } = await apiUpload<{ asset: AssetInfo }>(`/lab/assets?kind=${kind}`, prepared, "POST");
      onChange(asset.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't upload the image");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid content-start gap-2">
      <span className="text-sm font-medium">{label}</span>
      {hint && <span className="-mt-1 text-xs text-muted-foreground">{hint}</span>}
      <input
        ref={input}
        type="file"
        accept={ASSET_MIME_TYPES.join(",")}
        className="hidden"
        onChange={(e) => {
          void pick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <Button type="button" variant="outline" className="justify-self-start" disabled={disabled || busy} onClick={() => input.current?.click()}>
        {busy ? <Spinner /> : <UploadIcon />} Click to Upload
      </Button>
      {assetId && (
        <div className="flex items-center gap-3 rounded-lg border p-2">
          <div className="flex h-14 w-16 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
            {url && (
              // eslint-disable-next-line @next/next/no-img-element -- a blob URL from the API
              <img src={url} alt={fileLabel} className="max-h-full max-w-full object-contain" />
            )}
          </div>
          {url ? (
            <a href={url} target="_blank" rel="noreferrer" className="flex-1 truncate text-sm text-blue-600 hover:underline">
              {fileLabel}
            </a>
          ) : (
            <span className="flex-1 truncate text-sm text-muted-foreground">{fileLabel}</span>
          )}
          {!disabled && (
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${label}`} onClick={() => onChange(null)}>
              <Trash2Icon />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function HeaderFooterCard({ template }: { template: ReportTemplateItem }) {
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const editable = can("settings:write");
  const [backgroundId, setBackgroundId] = useState(template.backgroundImageId);
  const [outHeaderId, setOutHeaderId] = useState(template.outsourceHeaderImageId);
  const [outFooterId, setOutFooterId] = useState(template.outsourceFooterImageId);
  const [outFooterH, setOutFooterH] = useState(String(template.outsourceFooterHeightMm));
  const [leftM, setLeftM] = useState(String(template.leftMarginMm));
  const [rightM, setRightM] = useState(String(template.rightMarginMm));
  const [headerH, setHeaderH] = useState(String(template.headerHeightMm));
  const [footerH, setFooterH] = useState(String(template.footerHeightMm));
  const [font, setFont] = useState<ReportFontId>(template.fontFamily);

  const hh = Number(headerH);
  const fh = Number(footerH);
  const headerError = !Number.isInteger(hh) || hh < 0 || hh > 150 ? "Enter 0 to 150 mm" : null;
  const footerError = !Number.isInteger(fh) || fh < 0 || fh > 150 ? "Enter 0 to 150 mm" : null;
  const lm = Number(leftM);
  const rm = Number(rightM);
  const leftError = !Number.isInteger(lm) || lm < 0 || lm > 60 ? "Enter 0 to 60 mm" : null;
  const rightError = !Number.isInteger(rm) || rm < 0 || rm > 60 ? "Enter 0 to 60 mm" : null;
  const ofh = Number(outFooterH);
  const outFooterError = !Number.isInteger(ofh) || ofh < 0 || ofh > 150 ? "Enter 0 to 150 mm" : null;
  const dirty =
    outHeaderId !== template.outsourceHeaderImageId ||
    outFooterId !== template.outsourceFooterImageId ||
    ofh !== template.outsourceFooterHeightMm ||
    backgroundId !== template.backgroundImageId ||
    lm !== template.leftMarginMm ||
    font !== template.fontFamily ||
    rm !== template.rightMarginMm || hh !== template.headerHeightMm || fh !== template.footerHeightMm;

  const [previewing, setPreviewing] = useState(false);

  const body = () => ({
    ...template,
    // A background image is the whole letterhead; removing it again goes back to the lab-profile letterhead.
    style: backgroundId ? "PREPRINTED" : template.backgroundImageId && template.style === "PREPRINTED" ? "BUILT_IN" : template.style,
    backgroundImageId: backgroundId,
    leftMarginMm: lm,
    rightMarginMm: rm,
    outsourceHeaderImageId: outHeaderId,
    outsourceFooterImageId: outFooterId,
    outsourceFooterHeightMm: ofh,
    headerHeightMm: hh,
    footerHeightMm: fh,
    fontFamily: font,
  });

  /** A sample report with the values as they are now (saved or not), so the margins can be adjusted by eye. */
  async function preview() {
    const tab = window.open("", "_blank");
    setPreviewing(true);
    try {
      const blob = await apiBlob("/lab/templates/preview", { method: "POST", body: body() });
      const url = URL.createObjectURL(blob);
      if (tab) tab.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      tab?.close();
      toast.error(err instanceof Error ? err.message : "Couldn't draw the preview");
    } finally {
      setPreviewing(false);
    }
  }

  const save = useMutation({
    mutationFn: () => api(`/lab/templates/${template.id}`, { method: "PUT", body: body() }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: brandingKeys.templates });
      toast.success("Saved");
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Header, Footer &amp; Margins</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-6">
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        <ImageUpload
          kind="BACKGROUND"
          label="Report Background"
          fileLabel="Report Background"
          hint="Your full letterhead as an A4 page image (595 × 842 pt, e.g. 1240 × 1754 px). It prints behind every page."
          assetId={backgroundId}
          disabled={!editable}
          onChange={setBackgroundId}
        />
          <ImageUpload kind="HEADER" label="Outsource Report Header" fileLabel="Outsource Report Header" assetId={outHeaderId} disabled={!editable} onChange={setOutHeaderId} />
          <ImageUpload kind="FOOTER" label="Outsource Report Footer" fileLabel="Outsource Report Footer" assetId={outFooterId} disabled={!editable} onChange={setOutFooterId} />
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Field data-invalid={!!headerError}>
            <FieldLabel htmlFor="rd-hh">Header Height (mm)</FieldLabel>
            <p className="text-xs text-muted-foreground">Blank space at the top, where your letterhead is.</p>
            <Input id="rd-hh" type="number" inputMode="numeric" min={0} max={150} disabled={!editable} value={headerH} onChange={(e) => setHeaderH(e.target.value)} aria-invalid={!!headerError} />
            {headerError && <FieldError>{headerError}</FieldError>}
          </Field>
          <Field data-invalid={!!footerError}>
            <FieldLabel htmlFor="rd-fh">Footer Height (mm)</FieldLabel>
            <p className="text-xs text-muted-foreground">Blank space at the bottom.</p>
            <Input id="rd-fh" type="number" inputMode="numeric" min={0} max={150} disabled={!editable} value={footerH} onChange={(e) => setFooterH(e.target.value)} aria-invalid={!!footerError} />
            {footerError && <FieldError>{footerError}</FieldError>}
          </Field>
          <Field data-invalid={!!outFooterError}>
            <FieldLabel htmlFor="rd-ofh">Outsource Footer Height (mm)</FieldLabel>
            <Input id="rd-ofh" type="number" inputMode="numeric" min={0} max={150} disabled={!editable} value={outFooterH} onChange={(e) => setOutFooterH(e.target.value)} aria-invalid={!!outFooterError} />
            {outFooterError && <FieldError>{outFooterError}</FieldError>}
          </Field>
          <Field data-invalid={!!leftError}>
            <FieldLabel htmlFor="rd-lm">Report Left Margin (mm)</FieldLabel>
            <Input id="rd-lm" type="number" inputMode="numeric" min={0} max={60} disabled={!editable} value={leftM} onChange={(e) => setLeftM(e.target.value)} aria-invalid={!!leftError} />
            {leftError && <FieldError>{leftError}</FieldError>}
          </Field>
          <Field data-invalid={!!rightError}>
            <FieldLabel htmlFor="rd-rm">Report Right Margin (mm)</FieldLabel>
            <Input id="rd-rm" type="number" inputMode="numeric" min={0} max={60} disabled={!editable} value={rightM} onChange={(e) => setRightM(e.target.value)} aria-invalid={!!rightError} />
            {rightError && <FieldError>{rightError}</FieldError>}
          </Field>
          <Field>
            <FieldLabel htmlFor="rd-font">Report Font</FieldLabel>
            <Select value={font} onValueChange={(v) => setFont(v as ReportFontId)} disabled={!editable}>
              <SelectTrigger id="rd-font" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REPORT_FONTS.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        {editable && (
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={!!headerError || !!footerError || !!outFooterError || !!leftError || !!rightError || previewing} onClick={() => void preview()}>
              {previewing ? <Spinner /> : <EyeIcon />} Preview
            </Button>
            <Button disabled={!dirty || !!headerError || !!footerError || !!outFooterError || !!leftError || !!rightError || save.isPending} onClick={() => save.mutate()}>
              {save.isPending && <Spinner />}
              Save
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** The "Report Details" tab: header and footer images and their heights for the default report letterhead. */
export function ReportDetails() {
  const { data: templates, isPending } = useTemplates();
  const template = templates?.find((t) => t.isDefault) ?? templates?.[0];

  if (isPending) return <Skeleton className="h-64 w-full" />;
  return (
    <div className="space-y-6">
      {template ? (
        <HeaderFooterCard key={template.updatedAt} template={template} />
      ) : (
        <p className="text-sm text-muted-foreground">No report letterhead yet. Create one to set its header and footer.</p>
      )}
      <div className="grid gap-3 rounded-lg border p-4 text-sm">
        <p className="font-medium">More letterheads</p>
        <p className="text-muted-foreground">
          These settings apply to your default letterhead. Make others for pre-printed paper or a partner hospital&apos;s letterhead.
        </p>
        <Button asChild variant="outline" size="sm" className="justify-self-start">
          <Link href="/settings/report-templates">
            Manage letterheads <ArrowRightIcon />
          </Link>
        </Button>
      </div>
    </div>
  );
}
