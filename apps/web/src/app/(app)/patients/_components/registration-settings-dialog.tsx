"use client";

import { useState } from "react";
import { SettingsIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { CustomiseButtons } from "./customise-registration-dialog";
import { ReportSettingsTab } from "./report-settings-tab";
import { DEFAULT_REPORT_HEADER, type ReportHeaderSettings } from "@lms/shared";
import { useReportHeaderSettings, useSaveReportHeaderSettings } from "@/lib/reports";
import {
  BARCODE_TYPE_OPTIONS,
  barcodeMode,
  DEFAULT_SETTINGS,
  INTEGRATION_FIELD_OPTIONS,
  PRINT_BARCODE_OPTIONS,
  type IntegrationSettings,
  REQUIRED_FIELD_OPTIONS,
  useRegistrationSettings,
  type DisplaySettings,
  type NameLayout,
  type QuickSettings,
} from "@/lib/registration-settings";

const TABS = ["Display Fields", "Report Setting", "Integration", "Pick List"] as const;

const NAME_LAYOUTS: { value: NameLayout; label: string }[] = [
  { value: "full", label: "Patient Full Name" },
  { value: "split", label: "Patient First Middle & Last Name" },
];

function DisplayFieldsTab({ d, set }: { d: DisplaySettings; set: (next: DisplaySettings) => void }) {
  return (
    <div className="flex flex-col gap-6">
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm text-muted-foreground">Select Patient Name Layout</legend>
      {NAME_LAYOUTS.map((o) => (
        <label key={o.value} className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="radio"
            name="nameLayout"
            className="size-4 accent-primary"
            checked={d.nameLayout === o.value}
            onChange={() => set({ ...d, nameLayout: o.value })}
          />
          {o.label}
        </label>
      ))}
    </fieldset>
      <fieldset>
        <legend className="mb-3 text-sm text-muted-foreground">
          Required(<span className="text-destructive">*</span>) Fields
        </legend>
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
          {REQUIRED_FIELD_OPTIONS.map((o) => (
            <label key={o.key} className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={d.requiredFields.includes(o.key)}
                onChange={(e) =>
                  set({
                    ...d,
                    requiredFields: e.target.checked
                      ? [...d.requiredFields, o.key]
                      : d.requiredFields.filter((k) => k !== o.key),
                  })
                }
              />
              {o.label}
            </label>
          ))}
        </div>
      </fieldset>
      <CustomiseButtons d={d} set={set} />
    </div>
  );
}

function CheckGroup({
  options, value, onChange,
}: { options: { key: string; label: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2">
      {options.map((o) => (
        <label key={o.key} className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={value.includes(o.key)}
            onChange={(e) => onChange(e.target.checked ? [...value, o.key] : value.filter((k) => k !== o.key))}
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}

function IntegrationTab({ v, set }: { v: IntegrationSettings; set: (next: IntegrationSettings) => void }) {
  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-lg border">
        <h3 className="border-b bg-muted/40 px-4 py-3 text-sm font-semibold">Machine Integration</h3>
        <div className="grid gap-3 p-4">
          <p className="text-sm">Fields to Show</p>
          <CheckGroup options={INTEGRATION_FIELD_OPTIONS} value={v.fieldsToShow} onChange={(fieldsToShow) => set({ ...v, fieldsToShow })} />
        </div>
      </section>
      <section className="rounded-lg border">
        <h3 className="border-b bg-muted/40 px-4 py-3 text-sm font-semibold">Barcode</h3>
        <div className="grid gap-4 p-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={v.autoGenerateBarcode}
              onChange={(e) => set({ ...v, autoGenerateBarcode: e.target.checked })}
            />
            Auto generate barcode
          </label>
          <div className="grid gap-2 border-t pt-4">
            <p className="text-sm">Barcode Type</p>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {BARCODE_TYPE_OPTIONS.map((o) => (
                <label key={o.key} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="barcodeType"
                    className="size-4 accent-primary"
                    checked={barcodeMode(v) === o.key}
                    onChange={() => set({ ...v, barcodeTypes: [o.key] })}
                  />
                  {o.label}
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Patient wise: one barcode for the whole visit. Sample wise: one per tube. Department wise: one per department.
            </p>
          </div>
          <div className="grid gap-2 border-t pt-4">
            <p className="text-sm">Print Barcode</p>
            <CheckGroup options={PRINT_BARCODE_OPTIONS} value={v.printBarcode} onChange={(printBarcode) => set({ ...v, printBarcode })} />
          </div>
        </div>
      </section>
    </div>
  );
}

export function RegistrationSettingsButton() {
  const [open, setOpen] = useState(false);
  const [saved, save] = useRegistrationSettings();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Display Fields");
  const [draft, setDraft] = useState<QuickSettings>(saved.quick);
  const [display, setDisplay] = useState<DisplaySettings>(saved.display);
  const [integration, setIntegration] = useState<IntegrationSettings>(saved.integration);
  const header = useReportHeaderSettings();
  const saveHeader = useSaveReportHeaderSettings();
  const [report, setReport] = useState<ReportHeaderSettings>(DEFAULT_REPORT_HEADER);
  // Report settings live on the server (they shape every report PDF), so they load when the dialog opens.
  const [loadedReport, setLoadedReport] = useState<ReportHeaderSettings | undefined>();
  if (open && header.data && loadedReport !== header.data) {
    setLoadedReport(header.data);
    setReport(header.data);
  }

  function onOpenChange(next: boolean) {
    if (next) { setDraft(saved.quick); setDisplay(saved.display); setIntegration(saved.integration); setTab("Display Fields"); setLoadedReport(undefined); if (header.data) { setReport(header.data); setLoadedReport(header.data); } }
    setOpen(next);
  }

  return (
    <>
      <Button
        type="button"
        size="icon"
        aria-label="Registration settings"
        title="Registration settings"
        onClick={() => onOpenChange(true)}
        className="group size-11 rounded-full shadow-md transition-all hover:scale-105 hover:shadow-lg"
      >
        <SettingsIcon className="size-6 transition-transform duration-500 group-hover:rotate-90" />
      </Button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Registration Settings</DialogTitle>
            <DialogDescription className="sr-only">Defaults and preferences for registration and billing.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-1 border-b">
            {TABS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={
                  tab === t
                    ? "-mb-px border-b-2 border-primary px-3 py-2 text-sm font-medium text-primary"
                    : "-mb-px border-b-2 border-transparent px-3 py-2 text-sm hover:text-primary"
                }
              >
                {t}
              </button>
            ))}
          </div>
          {tab === "Display Fields" ? (
            <DisplayFieldsTab d={display} set={setDisplay} />
          ) : tab === "Report Setting" ? (
            <ReportSettingsTab value={report} onChange={setReport} />
          ) : tab === "Integration" ? (
            <IntegrationTab v={integration} set={setIntegration} />
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">{tab} options are coming soon.</p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { setDraft(DEFAULT_SETTINGS.quick); setDisplay(DEFAULT_SETTINGS.display); setIntegration(DEFAULT_SETTINGS.integration); setReport(DEFAULT_REPORT_HEADER); }}>Reset</Button>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Close</Button>
            <Button
              type="button"
              disabled={saveHeader.isPending}
              onClick={async () => {
                if (report.fields.length === 0) {
                  setTab("Report Setting");
                  toast.error("Pick at least one detail to print on the report");
                  return;
                }
                try {
                  // Only send report settings if they changed, so a front desk without them loaded can't overwrite the lab's choice.
                  if (loadedReport && JSON.stringify(report) !== JSON.stringify(loadedReport)) await saveHeader.mutateAsync(report);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Couldn't save the report settings");
                  return;
                }
                save({ quick: draft, display, integration });
                toast.success("Registration settings saved");
                setOpen(false);
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
