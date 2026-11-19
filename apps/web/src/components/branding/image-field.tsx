"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { ImageUpIcon, PenLineIcon, Trash2Icon } from "lucide-react";
import { ASSET_MAX_BYTES, ASSET_MIME_TYPES, type AssetKind } from "@lms/shared";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { cleanSignatureImage, shrinkImage, useAssetUrl } from "@/lib/branding";
import { cn } from "@/lib/utils";

/** Checkerboard behind images, so transparent areas are visible as such. */
const CHECKER =
  "bg-[length:16px_16px] bg-[linear-gradient(45deg,var(--muted)_25%,transparent_25%),linear-gradient(-45deg,var(--muted)_25%,transparent_25%),linear-gradient(45deg,transparent_75%,var(--muted)_75%),linear-gradient(-45deg,transparent_75%,var(--muted)_75%)] bg-[position:0_0,0_8px,8px_-8px,-8px_0]";

/** Largest side kept for each kind; bigger only slows down PDFs. */
const MAX_SIDE: Record<AssetKind, number> = { LOGO: 800, HEADER: 2480, FOOTER: 2480, SIGNATURE: 1000, STAMP: 800, BACKGROUND: 3508, DOCTOR_SIGNATURE: 1000 };

interface ImageFieldProps {
  kind: AssetKind;
  label: string;
  description?: React.ReactNode;
  assetId: string | null;
  /** Sends the prepared image to the API. */
  onUpload: (file: Blob) => Promise<unknown>;
  onRemove?: () => Promise<unknown>;
  disabled?: boolean;
  /** Tailwind height for the preview box. */
  previewClassName?: string;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong");

/** Shows a stored image with buttons to upload, replace or remove it. Signatures can also be drawn. */
export function ImageField({ kind, label, description, assetId, onUpload, onRemove, disabled, previewClassName = "h-28" }: ImageFieldProps) {
  const url = useAssetUrl(assetId);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const personal = kind === "SIGNATURE" || kind === "STAMP";
  // Photos of signatures and stamps usually need the paper removed; letterheads and logos are kept as they are.
  const [cleanUp, setCleanUp] = useState(personal);

  async function run(work: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await work();
      toast.success(done);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  function pick(file: File | undefined) {
    if (!file) return;
    if (!(ASSET_MIME_TYPES as readonly string[]).includes(file.type)) {
      toast.error("Use a PNG or JPEG image");
      return;
    }
    void run(async () => {
      const prepared = cleanUp ? await cleanSignatureImage(file, { maxSide: MAX_SIDE[kind] }) : await shrinkImage(file, MAX_SIDE[kind]);
      if (prepared.size > ASSET_MAX_BYTES[kind]) {
        throw new Error(`That image is still over ${Math.round(ASSET_MAX_BYTES[kind] / 1024)} KB after resizing. Try a simpler or smaller file.`);
      }
      await onUpload(prepared);
    }, `${label} saved`);
  }

  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className={cn("flex items-center justify-center overflow-hidden rounded-lg border", CHECKER, previewClassName)}>
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- a blob URL from the API, no optimisation needed
          <img src={url} alt={label} className="max-h-full max-w-full object-contain p-2" />
        ) : (
          <span className="bg-background/80 px-2 text-sm text-muted-foreground">{busy ? "Saving…" : `No ${label.toLowerCase()} yet`}</span>
        )}
      </div>
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      {!disabled && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={input}
              type="file"
              accept={ASSET_MIME_TYPES.join(",")}
              className="hidden"
              onChange={(e) => {
                pick(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>
              {busy ? <Spinner /> : <ImageUpIcon />} {assetId ? "Replace" : "Upload"}
            </Button>
            {kind === "SIGNATURE" && (
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setDrawing(true)}>
                <PenLineIcon /> Draw
              </Button>
            )}
            {assetId && onRemove && (
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => run(onRemove, `${label} removed`)}>
                <Trash2Icon /> Remove
              </Button>
            )}
          </div>
          {personal && (
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <Checkbox checked={cleanUp} onCheckedChange={(v) => setCleanUp(v === true)} />
              Remove the paper background and trim the edges
            </label>
          )}
        </>
      )}
      {drawing && (
        <DrawSignatureDialog
          onClose={() => setDrawing(false)}
          onDone={(blob) => {
            setDrawing(false);
            void run(() => onUpload(blob), `${label} saved`);
          }}
        />
      )}
    </div>
  );
}

/** Sign with a finger, stylus or mouse. */
function DrawSignatureDialog({ onClose, onDone }: { onClose: () => void; onDone: (blob: Blob) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);
  const [saving, setSaving] = useState(false);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvas.current!;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height };
  };
  const stroke = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const ctx = canvas.current!.getContext("2d")!;
    ctx.strokeStyle = "#0b1f4a";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  };

  async function save() {
    setSaving(true);
    try {
      const raw = await new Promise<Blob>((resolve, reject) => canvas.current!.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't read the drawing"))), "image/png"));
      onDone(await cleanSignatureImage(raw));
    } catch (err) {
      toast.error(errorText(err));
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Draw your signature</DialogTitle>
          <DialogDescription>Sign inside the box with your finger, a stylus or the mouse.</DialogDescription>
        </DialogHeader>
        <canvas
          ref={canvas}
          width={1200}
          height={450}
          className="aspect-[8/3] w-full touch-none rounded-lg border bg-white"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            last.current = point(e);
            stroke(last.current, last.current);
            setEmpty(false);
          }}
          onPointerMove={(e) => {
            if (!last.current) return;
            const p = point(e);
            stroke(last.current, p);
            last.current = p;
          }}
          onPointerUp={() => (last.current = null)}
          onPointerCancel={() => (last.current = null)}
        />
        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              const c = canvas.current!;
              c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
              setEmpty(true);
            }}
          >
            Clear
          </Button>
          <Button type="button" disabled={empty || saving} onClick={save}>
            {saving && <Spinner />}
            Use this signature
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
