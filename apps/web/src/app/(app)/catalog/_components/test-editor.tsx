"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, FormProvider, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeftIcon, EyeIcon, TriangleAlertIcon } from "lucide-react";
import { SAMPLE_TYPES, testSchema, type TestDetail, type TestOutput } from "@lms/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { MoneyInput } from "@/components/inputs/money-input";
import { NumberInput } from "@/components/inputs/number-input";
import { useAuth } from "@/providers/auth-provider";
import { api } from "@/lib/api";
import { catalogKeys, useDepartments } from "@/lib/catalog";
import { showFormError } from "@/lib/forms";
import { APP_NAME } from "@/lib/brand";
import { blankParameter, newCultureConfig, newTestValues, testToFormValues, type TestFormValues } from "./form-types";
import { CultureConfigEditor } from "./culture-config-editor";
import { PanelTestsEditor } from "./panel-tests-editor";
import { ParametersEditor } from "./parameters-editor";
import { TestPreviewDialog } from "./test-preview-dialog";

export function TestEditor({ test, isPanel = false }: { test?: TestDetail; isPanel?: boolean }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const departments = useDepartments();
  const readOnly = !can("catalog:write");
  const panel = test?.isPanel ?? isPanel;
  const [previewOpen, setPreviewOpen] = useState(false);

  const form = useForm<TestFormValues, unknown, TestOutput>({
    resolver: zodResolver(testSchema),
    defaultValues: test ? testToFormValues(test) : newTestValues(isPanel),
  });
  const { errors, isDirty } = form.formState;
  const culture = form.watch("reportKind") === "CULTURE" && !panel;
  const setReportKind = (kind: "STANDARD" | "CULTURE") => {
    form.setValue("reportKind", kind, { shouldDirty: true });
    if (kind === "CULTURE") {
      if (!form.getValues("cultureConfig")) form.setValue("cultureConfig", newCultureConfig(form.getValues("sampleType") || "URINE"), { shouldDirty: true });
      form.setValue("parameters", [], { shouldDirty: true });
    } else if ((form.getValues("parameters") ?? []).length === 0) {
      form.setValue("parameters", [blankParameter()], { shouldDirty: true });
    }
  };

  const save = useMutation({
    mutationFn: (values: TestOutput) =>
      test
        ? api<{ test: TestDetail }>(`/catalog/tests/${test.id}`, { method: "PUT", body: values })
        : api<{ test: { id: string } }>("/catalog/tests", { method: "POST", body: values }),
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: catalogKeys.all });
      if (test) {
        const updated = (res as { test: TestDetail }).test;
        queryClient.setQueryData(catalogKeys.test(test.id), updated);
        form.reset(testToFormValues(updated));
        toast.success("Saved");
      } else {
        toast.success(`${panel ? "Panel" : "Test"} created`);
        router.replace(`/catalog/${res.test.id}`);
      }
    },
    onError: (err) => showFormError(err, form.setError),
  });

  const toggleActive = useMutation({
    mutationFn: (isActive: boolean) => api(`/catalog/tests/${test!.id}/status`, { method: "PATCH", body: { isActive } }),
    onSuccess: async (_r, isActive) => {
      toast.success(isActive ? "Activated" : "Deactivated. It can't be ordered until you activate it again.");
      await queryClient.invalidateQueries({ queryKey: catalogKeys.all });
    },
    onError: (err) => toast.error(err.message),
  });

  const onSubmit = form.handleSubmit(
    (values) => save.mutate(values),
    () => toast.error("Some fields need attention"),
  );

  return (
    <FormProvider {...form}>
      <title>{`${test ? test.name : panel ? "New panel" : "New test"} · Test List · ${APP_NAME}`}</title>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6 pb-20">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/catalog" aria-label="Back to Test List">
              <ArrowLeftIcon />
            </Link>
          </Button>
          <div className="flex-1">
            <h1 className="text-xl font-semibold tracking-tight">
              {test ? test.name : panel ? "New panel" : "New test"}
            </h1>
            {test && (
              <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span className="font-mono">{test.code}</span>·<span>{test.department.name}</span>
                {panel && <Badge variant="secondary">Panel</Badge>}
                {!test.isActive && <Badge variant="outline">Inactive</Badge>}
              </p>
            )}
          </div>
          <Button type="button" variant="outline" onClick={() => setPreviewOpen(true)}>
            <EyeIcon /> Preview report
          </Button>
          {test && !readOnly && (
            <Button
              type="button"
              variant="outline"
              disabled={toggleActive.isPending}
              onClick={() => toggleActive.mutate(!test.isActive)}
            >
              {toggleActive.isPending && <Spinner />}
              {test.isActive ? "Deactivate" : "Activate"}
            </Button>
          )}
        </div>

        {test && test.usedInPanels.length > 0 && (
          <p className="text-sm text-muted-foreground">
            Part of:{" "}
            {test.usedInPanels.map((p, i) => (
              <span key={p.id}>
                {i > 0 && ", "}
                <Link href={`/catalog/${p.id}`} className="underline underline-offset-4">
                  {p.name}
                </Link>
              </span>
            ))}
          </p>
        )}

        <fieldset disabled={readOnly} className="contents">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <FieldGroup className="grid gap-4 md:grid-cols-6">
                <Field data-invalid={!!errors.name} className="md:col-span-4">
                  <FieldLabel htmlFor="name">Name</FieldLabel>
                  <Input id="name" aria-invalid={!!errors.name} {...form.register("name")} />
                  <FieldError errors={[errors.name]} />
                </Field>
                <Field data-invalid={!!errors.code} className="md:col-span-2">
                  <FieldLabel htmlFor="code">Code</FieldLabel>
                  <Input id="code" className="font-mono uppercase" aria-invalid={!!errors.code} {...form.register("code")} />
                  {errors.code ? <FieldError errors={[errors.code]} /> : <FieldDescription>Short code used at billing</FieldDescription>}
                </Field>

                <Field data-invalid={!!errors.departmentId} className="md:col-span-2">
                  <FieldLabel htmlFor="department">Department</FieldLabel>
                  <Controller
                    control={form.control}
                    name="departmentId"
                    render={({ field }) => (
                      <Select value={field.value || undefined} onValueChange={field.onChange}>
                        <SelectTrigger id="department" className="w-full" aria-invalid={!!errors.departmentId}>
                          <SelectValue placeholder="Pick a department" />
                        </SelectTrigger>
                        <SelectContent>
                          {departments.data?.map((d) => (
                            <SelectItem key={d.id} value={d.id}>
                              {d.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  <FieldError errors={[errors.departmentId]} />
                </Field>

                <Field data-invalid={!!errors.sampleType} className="md:col-span-2">
                  <FieldLabel htmlFor="sampleType">Sample type</FieldLabel>
                  <Controller
                    control={form.control}
                    name="sampleType"
                    render={({ field }) => (
                      <Select
                        value={field.value || undefined}
                        onValueChange={(v) => {
                          // Fill in the usual tube unless the user typed their own.
                          const prevDefault = SAMPLE_TYPES.find((s) => s.key === field.value)?.container ?? "";
                          const container = form.getValues("container");
                          if (!container || container === prevDefault) {
                            form.setValue("container", SAMPLE_TYPES.find((s) => s.key === v)?.container ?? "", {
                              shouldDirty: true,
                            });
                          }
                          field.onChange(v);
                        }}
                      >
                        <SelectTrigger id="sampleType" className="w-full" aria-invalid={!!errors.sampleType}>
                          <SelectValue placeholder="Pick a sample type" />
                        </SelectTrigger>
                        <SelectContent>
                          {SAMPLE_TYPES.map((s) => (
                            <SelectItem key={s.key} value={s.key}>
                              {s.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  <FieldError errors={[errors.sampleType]} />
                </Field>

                <Field className="md:col-span-2">
                  <FieldLabel htmlFor="container">Container</FieldLabel>
                  <Input id="container" {...form.register("container")} />
                </Field>

                {!panel && (
                  <Field className="md:col-span-2">
                    <FieldLabel htmlFor="reportKind">Report type</FieldLabel>
                    <Select value={culture ? "CULTURE" : "STANDARD"} onValueChange={(v) => setReportKind(v as "STANDARD" | "CULTURE")}>
                      <SelectTrigger id="reportKind" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="STANDARD">Standard (values and ranges)</SelectItem>
                        <SelectItem value="CULTURE">Culture &amp; sensitivity (antibiotics)</SelectItem>
                      </SelectContent>
                    </Select>
                    <FieldDescription>
                      {culture ? "Growth or no growth, with an antibiotic sensitivity table." : "Numbers, text or pick-from-list results."}
                    </FieldDescription>
                  </Field>
                )}

                {!panel && (
                  <Field className="md:col-span-2">
                    <FieldLabel htmlFor="method">Method</FieldLabel>
                    <Input id="method" placeholder="e.g. CLIA, HPLC" {...form.register("method")} />
                  </Field>
                )}

                <Field data-invalid={!!errors.tatHours} className="md:col-span-2">
                  <FieldLabel htmlFor="tat">Turnaround time (hours)</FieldLabel>
                  <Controller
                    control={form.control}
                    name="tatHours"
                    render={({ field }) => (
                      <NumberInput
                        id="tat"
                        aria-invalid={!!errors.tatHours}
                        value={field.value}
                        onChange={(v) => field.onChange(v == null ? undefined : Math.round(v))}
                      />
                    )}
                  />
                  <FieldError errors={[errors.tatHours]} />
                </Field>

                <Field data-invalid={!!errors.pricePaise} className="md:col-span-2">
                  <FieldLabel htmlFor="price">Price</FieldLabel>
                  <Controller
                    control={form.control}
                    name="pricePaise"
                    render={({ field }) => (
                      <MoneyInput id="price" value={field.value} onChange={(p) => field.onChange(p ?? 0)} />
                    )}
                  />
                  {errors.pricePaise ? (
                    <FieldError errors={[errors.pricePaise]} />
                  ) : (
                    <FieldDescription>Base rate. Price lists can override it.</FieldDescription>
                  )}
                </Field>

                <Field className="md:col-span-6">
                  <FieldLabel htmlFor="notes">Notes on report (optional)</FieldLabel>
                  <Textarea id="notes" rows={2} placeholder="Short notes printed under the results, e.g. sample or fasting requirements" {...form.register("reportNotes")} />
                </Field>

                <Field className="md:col-span-6">
                  <FieldLabel htmlFor="interpretation">Interpretation (optional)</FieldLabel>
                  <Textarea
                    id="interpretation"
                    rows={4}
                    placeholder="Clinical interpretation printed after the results, e.g. 5.7 to 6.4%: prediabetes. 6.5% or above: diabetes."
                    {...form.register("interpretation")}
                  />
                  <FieldDescription>Printed under an &ldquo;Interpretation&rdquo; heading on the report.</FieldDescription>
                </Field>
              </FieldGroup>
            </CardContent>
          </Card>

          {panel ? (
            <Card>
              <CardHeader>
                <CardTitle>Tests in this panel</CardTitle>
                <CardDescription>Reported in this order.</CardDescription>
              </CardHeader>
              <CardContent>
                <PanelTestsEditor selfId={test?.id} />
              </CardContent>
            </Card>
          ) : culture ? (
            <Card>
              <CardHeader>
                <CardTitle>Culture &amp; sensitivity setup</CardTitle>
                <CardDescription>
                  Antibiotics available when reporting, and the wording used for a no-growth report.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <CultureConfigEditor />
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Parameters</CardTitle>
                <CardDescription>
                  What gets reported, in report order. Open a parameter to set its reference ranges.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Alert>
                  <TriangleAlertIcon />
                  <AlertTitle>Ranges must be verified by your pathologist</AlertTitle>
                  <AlertDescription>
                    Reference ranges depend on your analyzer, reagents and patients. Starter tests come with typical adult
                    ranges only.
                  </AlertDescription>
                </Alert>
                <ParametersEditor />
              </CardContent>
            </Card>
          )}
        </fieldset>

        {!readOnly && (
          <div className="sticky bottom-0 -mx-4 flex items-center justify-end gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
            {isDirty && <span className="mr-auto text-sm text-muted-foreground">Unsaved changes</span>}
            <Button type="button" variant="outline" asChild>
              <Link href="/catalog">Cancel</Link>
            </Button>
            <Button type="submit" disabled={save.isPending || (!!test && !isDirty)}>
              {save.isPending && <Spinner />}
              {test ? "Save changes" : panel ? "Create panel" : "Create test"}
            </Button>
          </div>
        )}
      </form>
      <TestPreviewDialog open={previewOpen} onOpenChange={setPreviewOpen} panel={panel} />
    </FormProvider>
  );
}
