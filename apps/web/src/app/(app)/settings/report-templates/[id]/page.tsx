"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useForm, useWatch, type Control, type FieldError as FieldErrorType, type UseFormRegisterReturn, type UseFormSetValue } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeftIcon, ExternalLinkIcon } from "lucide-react";
import {
  ACCENT_SWATCHES,
  DEFAULT_TEMPLATE,
  FLAG_SWATCHES,
  LETTERHEAD_STYLES,
  LETTERHEAD_STYLE_HINT,
  LETTERHEAD_STYLE_LABEL,
  reportTemplateSchema,
  type AssetInfo,
  type ReportTemplateInput,
  type ReportTemplateItem,
  type ReportTemplateValues,
} from "@lms/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { PageHeader } from "@/components/app-shell/page-header";
import { ImageField } from "@/components/branding/image-field";
import { api, apiBlob, apiUpload } from "@/lib/api";
import { APP_NAME } from "@/lib/brand";
import { brandingKeys, useTemplates } from "@/lib/branding";
import { showFormError } from "@/lib/forms";
import { cn } from "@/lib/utils";

type Values = ReportTemplateInput;

/** A PDF of a sample report drawn with the form's current settings, refreshed as they change. */
function LivePreview({ control }: { control: Control<Values, unknown, ReportTemplateValues> }) {
  const values = useWatch({ control });
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const latest = useRef(0);
  const key = JSON.stringify(values);

  useEffect(() => {
    // The name isn't printed, so an unnamed letterhead can still be previewed.
    const draft = JSON.parse(key) as Values;
    const parsed = reportTemplateSchema.safeParse({ ...draft, name: draft.name?.trim() || "Preview" });
    const run = ++latest.current;
    const timer = setTimeout(async () => {
      if (!parsed.success) {
        setProblem("Fix the highlighted settings to update the preview.");
        return;
      }
      setLoading(true);
      try {
        const blob = await apiBlob("/lab/templates/preview", { method: "POST", body: parsed.data });
        if (run !== latest.current) return;
        setUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return URL.createObjectURL(blob);
        });
        setProblem(null);
      } catch (err) {
        if (run === latest.current) setProblem(err instanceof Error ? err.message : "Couldn't draw the preview");
      } finally {
        if (run === latest.current) setLoading(false);
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [key]);

  return (
    <Card className="lg:sticky lg:top-4">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          Preview
          {loading && <Spinner />}
        </CardTitle>
        <CardDescription>A sample report with your lab&apos;s details. It&apos;s signed with your own signature, if you&apos;ve added one.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {problem && <p className="text-sm text-destructive">{problem}</p>}
        {url ? (
          <>
            <iframe title="Report preview" src={`${url}#toolbar=0&view=FitH`} className="aspect-[210/297] w-full rounded-lg border bg-white" />
            <Button variant="outline" size="sm" asChild>
              <a href={url} target="_blank" rel="noreferrer">
                <ExternalLinkIcon /> Open full size
              </a>
            </Button>
          </>
        ) : (
          <Skeleton className="aspect-[210/297] w-full" />
        )}
      </CardContent>
    </Card>
  );
}

function StylePicker({ value, onChange }: { value: ReportTemplateValues["style"]; onChange: (v: ReportTemplateValues["style"]) => void }) {
  return (
    <div role="radiogroup" aria-label="Letterhead" className="grid gap-2">
      {LETTERHEAD_STYLES.map((s) => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={value === s}
          onClick={() => onChange(s)}
          className={cn(
            "rounded-lg border p-3 text-left text-sm transition-colors hover:bg-accent/50",
            value === s && "border-primary bg-primary/5 ring-1 ring-primary",
          )}
        >
          <div className="font-medium">{LETTERHEAD_STYLE_LABEL[s]}</div>
          <div className="text-muted-foreground">{LETTERHEAD_STYLE_HINT[s]}</div>
        </button>
      ))}
    </div>
  );
}

function Toggle({ id, label, hint, checked, onChange }: { id: string; label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3 text-sm">
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} className="mt-0.5" />
      <span>
        {label}
        {hint && <span className="block text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

/** Swatches, a free colour picker and the hex value. */
function ColourField({
  id,
  label,
  hint,
  swatches,
  value,
  onPick,
  input,
  error,
}: {
  id: string;
  label: React.ReactNode;
  hint?: string;
  swatches: readonly string[];
  value: string | undefined;
  onPick: (c: string) => void;
  input: UseFormRegisterReturn;
  error?: FieldErrorType;
}) {
  const current = value?.toLowerCase();
  return (
    <Field data-invalid={!!error}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="flex flex-wrap items-center gap-2">
        {swatches.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Use ${c}`}
            aria-pressed={current === c.toLowerCase()}
            onClick={() => onPick(c)}
            className={cn("size-7 rounded-full border-2 border-background ring-1 ring-border", current === c.toLowerCase() && "ring-2 ring-primary")}
            style={{ background: c }}
          />
        ))}
        <input
          type="color"
          aria-label="Pick any colour"
          value={/^#[0-9a-f]{6}$/i.test(value ?? "") ? value : "#2d6a9f"}
          onChange={(e) => onPick(e.target.value.toUpperCase())}
          className="size-8 cursor-pointer rounded border bg-transparent"
        />
        <Input id={id} className="w-28 font-mono uppercase" maxLength={7} aria-invalid={!!error} {...input} />
      </div>
      {hint && <FieldDescription>{hint}</FieldDescription>}
      <FieldError errors={[error]} />
    </Field>
  );
}

function Editor({ template }: { template: ReportTemplateItem | null }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const form = useForm<Values, unknown, ReportTemplateValues>({
    resolver: zodResolver(reportTemplateSchema),
    defaultValues: template ?? { ...DEFAULT_TEMPLATE, name: "" },
  });
  const { errors } = form.formState;
  const [style, accent, headerImageId, footerImageId, showLogo, showSignatures, showQr, lowColor, highColor] = useWatch({
    control: form.control,
    name: ["style", "accentColor", "headerImageId", "footerImageId", "showLogo", "showSignatures", "showQr", "lowColor", "highColor"],
  });
  const set: UseFormSetValue<Values> = (name, value) => form.setValue(name, value, { shouldDirty: true, shouldValidate: true });

  const save = useMutation({
    mutationFn: (v: ReportTemplateValues) =>
      template
        ? api<{ template: ReportTemplateItem }>(`/lab/templates/${template.id}`, { method: "PUT", body: v })
        : api<{ template: ReportTemplateItem }>("/lab/templates", { method: "POST", body: v }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: brandingKeys.templates });
      toast.success("Letterhead saved");
      router.push("/settings/report-templates");
    },
    onError: (err) => showFormError(err, form.setError),
  });

  const upload = (kind: "HEADER" | "FOOTER") => async (file: Blob) => {
    const { asset } = await apiUpload<{ asset: AssetInfo }>(`/lab/assets?kind=${kind}`, file, "POST");
    if (kind === "HEADER") set("headerImageId", asset.id);
    else set("footerImageId", asset.id);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start">
      <form noValidate className="space-y-6" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
        <Card>
          <CardHeader>
            <CardTitle>Letterhead</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldGroup className="grid gap-4">
              <Field data-invalid={!!errors.name}>
                <FieldLabel htmlFor="t-name">Name</FieldLabel>
                <Input id="t-name" placeholder="e.g. Digital, Pre-printed paper, City Hospital" aria-invalid={!!errors.name} {...form.register("name")} />
                <FieldError errors={[errors.name]} />
              </Field>
              <StylePicker value={style} onChange={(v) => set("style", v)} />
            </FieldGroup>
          </CardContent>
        </Card>

        {style === "IMAGE" && (
          <Card>
            <CardHeader>
              <CardTitle>Header and footer images</CardTitle>
              <CardDescription>
                Export the top and bottom strips of your letterhead at full page width (A4 is 210 mm wide, about 2480 pixels at 300 dpi).
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6">
              <ImageField kind="HEADER" label="Header" assetId={headerImageId ?? null} previewClassName="h-24" onUpload={upload("HEADER")} onRemove={async () => set("headerImageId", null)} />
              {errors.headerImageId && <p className="-mt-4 text-sm text-destructive">{errors.headerImageId.message}</p>}
              <ImageField kind="FOOTER" label="Footer" description="Optional." assetId={footerImageId ?? null} previewClassName="h-16" onUpload={upload("FOOTER")} onRemove={async () => set("footerImageId", null)} />
            </CardContent>
          </Card>
        )}

        {style !== "BUILT_IN" && (
          <Card>
            <CardHeader>
              <CardTitle>{style === "IMAGE" ? "Image heights" : "Space to leave blank"}</CardTitle>
              <CardDescription>
                {style === "IMAGE"
                  ? "How tall the header and footer print. The images are scaled to fit."
                  : "Measure your letterhead paper: the printed header and footer, plus a little margin."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup className="grid gap-4 sm:grid-cols-2">
                <Field data-invalid={!!errors.headerHeightMm}>
                  <FieldLabel htmlFor="t-hh">Top (mm)</FieldLabel>
                  <Input id="t-hh" type="number" inputMode="numeric" min={0} max={150} aria-invalid={!!errors.headerHeightMm} {...form.register("headerHeightMm")} />
                  <FieldError errors={[errors.headerHeightMm]} />
                </Field>
                <Field data-invalid={!!errors.footerHeightMm}>
                  <FieldLabel htmlFor="t-fh">Bottom (mm)</FieldLabel>
                  <Input id="t-fh" type="number" inputMode="numeric" min={0} max={150} aria-invalid={!!errors.footerHeightMm} {...form.register("footerHeightMm")} />
                  <FieldError errors={[errors.footerHeightMm]} />
                </Field>
              </FieldGroup>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldGroup className="grid gap-5">
              <ColourField
                id="t-accent"
                label="Colour"
                swatches={ACCENT_SWATCHES}
                value={accent}
                onPick={(c) => set("accentColor", c)}
                input={form.register("accentColor")}
                error={errors.accentColor}
                hint={style === "BUILT_IN" ? "Used for your lab name, the header rule and section headings." : "Used for section headings."}
              />
              <div className="grid gap-5 sm:grid-cols-2">
                <ColourField
                  id="t-low"
                  label={
                    <>
                      Low values <span className="font-semibold" style={{ color: lowColor }}>11.2 L</span>
                    </>
                  }
                  swatches={FLAG_SWATCHES}
                  value={lowColor}
                  onPick={(c) => set("lowColor", c)}
                  input={form.register("lowColor")}
                  error={errors.lowColor}
                />
                <ColourField
                  id="t-high"
                  label={
                    <>
                      High values <span className="font-semibold" style={{ color: highColor }}>182 H</span>
                    </>
                  }
                  swatches={FLAG_SWATCHES}
                  value={highColor}
                  onPick={(c) => set("highColor", c)}
                  input={form.register("highColor")}
                  error={errors.highColor}
                />
              </div>
              <div className="grid gap-3">
                {style === "BUILT_IN" && (
                  <Toggle id="t-logo" label="Show the logo" hint="Upload it on the Lab profile page." checked={!!showLogo} onChange={(v) => set("showLogo", v)} />
                )}
                <Toggle
                  id="t-sign"
                  label="Print signatures and stamps"
                  hint="Of the pathologists who approved the results. Without them, their names print as electronically approved."
                  checked={!!showSignatures}
                  onChange={(v) => set("showSignatures", v)}
                />
                <Toggle id="t-qr" label="Print a QR code" hint="Patients and doctors scan it to see the report online." checked={!!showQr} onChange={(v) => set("showQr", v)} />
              </div>
              <Field data-invalid={!!errors.footerNote}>
                <FieldLabel htmlFor="t-note">Footer note</FieldLabel>
                <Input id="t-note" placeholder="e.g. For help, call 98200 12345" aria-invalid={!!errors.footerNote} {...form.register("footerNote")} />
                <FieldDescription>Printed at the bottom of every page. Optional.</FieldDescription>
                <FieldError errors={[errors.footerNote]} />
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button variant="outline" asChild>
            <Link href="/settings/report-templates">Cancel</Link>
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending && <Spinner />}
            {template ? "Save" : "Create letterhead"}
          </Button>
        </div>
      </form>
      <LivePreview control={form.control} />
    </div>
  );
}

export default function TemplateEditorPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === "new";
  const { data: templates, isPending } = useTemplates(!isNew);
  const template = isNew ? null : (templates?.find((t) => t.id === id) ?? null);
  return (
    <>
      <title>{`${isNew ? "New letterhead" : (template?.name ?? "Letterhead")} · ${APP_NAME}`}</title>
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-2">
          <Link href="/settings/report-templates">
            <ArrowLeftIcon /> Letterheads
          </Link>
        </Button>
        <PageHeader title={isNew ? "New letterhead" : `Edit ${template?.name ?? "letterhead"}`} />
      </div>
      {!isNew && isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : !isNew && !template ? (
        <p className="text-sm text-muted-foreground">This letterhead no longer exists.</p>
      ) : (
        <Editor key={template?.id ?? "new"} template={template} />
      )}
    </>
  );
}
