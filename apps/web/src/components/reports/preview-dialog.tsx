"use client";

import { useEffect, useRef, useState } from "react";
import { PrinterIcon } from "lucide-react";
import { patientDisplayName } from "@lms/shared";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { apiBlob } from "@/lib/api";
import { useReportDoctors } from "@/lib/branding";
import { cn } from "@/lib/utils";

/** The least a preview needs to know about an order. */
export interface PreviewTarget {
  orderId: string;
  orderNo: string;
  patient: Parameters<typeof patientDisplayName>[0];
}

export type Preview =
  | { kind: "bill" }
  | { kind: "barcode"; ids?: string[] }
  | { kind: "report"; opts: { templateId?: string; letterhead?: boolean; outsource?: boolean; doctors?: string[]; separate?: boolean } };

/** A modal showing the bill or report for a row, with a print button and a way to open it in its own tab. */
export function PreviewDialog({
  r,
  preview,
  onClose,
  portal = false,
}: {
  r: PreviewTarget;
  preview: Preview;
  onClose: () => void;
  /** A B2B client's view: the same modal, fetched from the portal's own endpoints. */
  portal?: boolean;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [separate, setSeparate] = useState(false);
  const { data: doctors } = useReportDoctors();
  const selectable = (doctors ?? []).filter((d) => d.mode === "SELECT");
  const [picked, setPicked] = useState<string[]>([]);

  // The PDF to fetch for the current choices; null for a bill, which is a page of its own.
  const path = (() => {
    if (preview.kind === "bill") return null;
    if (preview.kind === "barcode")
      return portal
        ? `/b2b/orders/${r.orderId}/labels${preview.ids ? `?ids=${preview.ids.join(",")}` : ""}`
        : `/samples/labels/${r.orderId}/pdf${preview.ids ? `?ids=${preview.ids.join(",")}` : ""}`;
    const { templateId, letterhead, outsource } = preview.opts;
    const qs = new URLSearchParams({
      ...(templateId ? { template: templateId } : {}),
      ...(letterhead === false ? { letterhead: "0" } : {}),
      ...(outsource ? { outsource: "1" } : {}),
      ...(separate ? { separate: "1" } : {}),
      ...(picked.length ? { doctors: picked.join(",") } : {}),
    });
    return `${portal ? `/b2b/orders/${r.orderId}/report` : `/reports/${r.orderId}/pdf`}${qs.size ? `?${qs}` : ""}`;
  })();
  // What was loaded, and for which path: a result for an older choice is never shown.
  const [loaded, setLoaded] = useState<{ path: string; url?: string; error?: string } | null>(null);
  const current = path && loaded?.path === path ? loaded : null;
  const url = preview.kind === "bill" ? `/print/bill/${r.orderId}${portal ? "?portal=1" : ""}` : (current?.url ?? null);
  const error = current?.error ?? null;

  useEffect(() => {
    if (!path) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    apiBlob(path)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setLoaded({ path, url: objectUrl });
      })
      .catch((err) => {
        if (!cancelled) setLoaded({ path, error: err instanceof Error ? err.message : "Couldn't open the report" });
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);

  const isBarcode = preview.kind === "barcode";
  const title =
    preview.kind === "bill" ? "Bill" : isBarcode ? "Print Barcode" : "Report";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className={cn(
          "flex h-[90vh] flex-col gap-3",
          isBarcode ? "sm:max-w-xl" : "sm:max-w-4xl",
        )}
      >
        <DialogHeader>
          <DialogTitle>
            {isBarcode ? title : `${title} · ${r.orderNo}`}
          </DialogTitle>
          <DialogDescription className={isBarcode ? "sr-only" : undefined}>
            {patientDisplayName(r.patient)}
          </DialogDescription>
          {preview.kind === "report" && (
            <label className="flex w-fit cursor-pointer items-center gap-2 pt-1 text-sm">
              <Switch
                checked={separate}
                onCheckedChange={setSeparate}
                aria-label="Separate test"
              />
              Separate test (each test on its own page)
            </label>
          )}
          {preview.kind === "report" && selectable.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-sm">
              <span className="text-muted-foreground">Signed by:</span>
              {selectable.map((d) => (
                <label key={d.id} className="flex cursor-pointer items-center gap-2">
                  <Checkbox
                    checked={picked.includes(d.id)}
                    onCheckedChange={(v) => setPicked((p) => (v === true ? [...p, d.id] : p.filter((x) => x !== d.id)))}
                  />
                  {d.name}
                </label>
              ))}
            </div>
          )}
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-hidden rounded-md border bg-muted">
          {error ? (
            <p className="p-6 text-sm text-destructive">{error}</p>
          ) : url ? (
            <iframe
              ref={frame}
              src={url}
              title={`${title} ${r.orderNo}`}
              className="size-full bg-white"
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <Spinner />
            </div>
          )}
        </div>
        {!isBarcode && (
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
            {url && (
              <Button variant="outline" asChild>
                <a href={url} target="_blank" rel="noreferrer">
                  Open in new tab
                </a>
              </Button>
            )}
            <Button
              disabled={!url}
              onClick={() => frame.current?.contentWindow?.print()}
            >
              <PrinterIcon /> Print
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

