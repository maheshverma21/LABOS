"use client";

import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { ExternalLinkIcon, FileTextIcon, SendToBackIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { OUTSOURCE_FILE_MAX_BYTES, OUTSOURCE_FILE_TYPES, type ResultSheet, type ResultTest } from "@lms/shared";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import { api, apiBlob, apiUpload } from "@/lib/api";
import { cn } from "@/lib/utils";

export type OutsourceMode = "manual" | "upload";

/** Choose how an outsourced test's result is given: typed in here, or the other lab's report uploaded. */
export function OutsourcePanel({
  test,
  editable,
  mode,
  onMode,
  onSheet,
}: {
  test: ResultTest;
  editable: boolean;
  mode: OutsourceMode;
  onMode: (m: OutsourceMode) => void;
  onSheet: (s: ResultSheet) => void | Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [opening, setOpening] = useState(false);
  // Chosen before a file is uploaded; once there is a file, its own setting is shown.
  const [pending, setPending] = useState(false);
  const file = test.outsourceFile;
  const path = `/results/tests/${test.orderTestId}/outsource-file`;

  const upload = useMutation({
    mutationFn: (f: File) => {
      if (!(OUTSOURCE_FILE_TYPES as readonly string[]).includes(f.type)) throw new Error("Choose a PDF, PNG or JPEG file");
      if (f.size > OUTSOURCE_FILE_MAX_BYTES) throw new Error("The file must be under 5 MB");
      return apiUpload<{ sheet: ResultSheet }>(`${path}?name=${encodeURIComponent(f.name)}${pending ? "&letterhead=1" : ""}`, f, "PUT");
    },
    onSuccess: async (r) => {
      toast.success("Report uploaded");
      await onSheet(r.sheet);
    },
    onError: (err) => toast.error(err.message),
  });
  const letterhead = useMutation({
    mutationFn: (addLetterhead: boolean) => api<{ sheet: ResultSheet }>(path, { method: "PATCH", body: { addLetterhead } }),
    onSuccess: (r) => onSheet(r.sheet),
    onError: (err) => toast.error(err.message),
  });
  const checked = file ? file.addLetterhead : pending;
  const remove = useMutation({
    mutationFn: () => api<{ sheet: ResultSheet }>(path, { method: "DELETE" }),
    onSuccess: async (r) => {
      toast.success("Report removed");
      await onSheet(r.sheet);
    },
    onError: (err) => toast.error(err.message),
  });

  async function view() {
    const tab = window.open("", "_blank");
    setOpening(true);
    try {
      const url = URL.createObjectURL(await apiBlob(path));
      if (tab) tab.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      tab?.close();
      toast.error(err instanceof Error ? err.message : "Couldn't open the file");
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-2 text-sm">
          <SendToBackIcon className="size-4 text-muted-foreground" />
          Outsourced to <strong>{test.outsourceLab}</strong>
        </span>
        <div role="radiogroup" aria-label="How to give the result" className="ml-auto flex rounded-lg border bg-background p-0.5 text-sm">
          {(
            [
              { v: "manual", label: "Enter manually" },
              { v: "upload", label: "Upload report" },
            ] as const
          ).map((o) => (
            <button
              key={o.v}
              type="button"
              role="radio"
              aria-checked={mode === o.v}
              onClick={() => onMode(o.v)}
              className={cn("rounded-md px-3 py-1", mode === o.v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {o.label}
              {o.v === "upload" && file ? " ✓" : ""}
            </button>
          ))}
        </div>
      </div>

      {mode === "upload" && (
        <div className="space-y-2">
          <input
            ref={input}
            type="file"
            accept={OUTSOURCE_FILE_TYPES.join(",")}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload.mutate(f);
              e.target.value = "";
            }}
          />
          {file ? (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-background p-2 text-sm">
              <FileTextIcon className="size-5 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <span className="text-xs text-muted-foreground">{Math.max(1, Math.round(file.size / 1024))} KB</span>
              <Button type="button" variant="outline" size="sm" disabled={opening} onClick={view}>
                {opening ? <Spinner /> : <ExternalLinkIcon />} View
              </Button>
              {editable && (
                <>
                  <Button type="button" variant="outline" size="sm" disabled={upload.isPending} onClick={() => input.current?.click()}>
                    {upload.isPending ? <Spinner /> : <UploadIcon />} Replace
                  </Button>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove report" disabled={remove.isPending} onClick={() => remove.mutate()}>
                    {remove.isPending ? <Spinner /> : <Trash2Icon />}
                  </Button>
                </>
              )}
            </div>
          ) : editable ? (
            <Button type="button" variant="outline" disabled={upload.isPending} onClick={() => input.current?.click()}>
              {upload.isPending ? <Spinner /> : <UploadIcon />} Click to Upload
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">No report uploaded.</p>
          )}
          {(editable || checked) && (
            <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
              <Checkbox
                checked={checked}
                disabled={!editable || letterhead.isPending}
                onCheckedChange={(v) => (file ? letterhead.mutate(v === true) : setPending(v === true))}
              />
              Add Letterhead
            </label>
          )}
          <p className="text-xs text-muted-foreground">
            Add Letterhead prints your Outsource Report Header and Footer (Lab profile, Report Details) on this file&apos;s pages. Leave it off if the file already has a letterhead.
          </p>
          <p className="text-xs text-muted-foreground">
            PDF, PNG or JPEG, up to 5 MB. Once this test is approved, the file prints after the report&apos;s own pages. You can submit it with no typed results.
          </p>
        </div>
      )}
    </div>
  );
}
