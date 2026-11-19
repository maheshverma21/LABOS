import { useQuery } from "@tanstack/react-query";
import { DEFAULT_BILL_SETTINGS, DEFAULT_TEMPLATE, type BillSettings, type MyProfile, type ReportDoctorItem, type ReportTemplateItem } from "@lms/shared";
import { api, apiBlob } from "./api";

export const brandingKeys = {
  templates: ["report-templates"] as const,
  profile: ["my-profile"] as const,
  bill: ["bill-settings"] as const,
  doctors: ["report-doctors"] as const,
  asset: (id: string) => ["asset", id] as const,
};

export function useTemplates(enabled = true) {
  return useQuery({
    queryKey: brandingKeys.templates,
    queryFn: () => api<{ templates: ReportTemplateItem[] }>("/lab/templates").then((r) => r.templates),
    enabled,
  });
}

/** The colours for low and high values, from the lab's default letterhead, so the app matches the reports. */
export function useFlagColours() {
  const { data } = useTemplates();
  const t = data?.find((x) => x.isDefault);
  return { low: t?.lowColor ?? DEFAULT_TEMPLATE.lowColor, high: t?.highColor ?? DEFAULT_TEMPLATE.highColor };
}

/** Doctors whose signatures print on reports. */
export function useReportDoctors() {
  return useQuery({
    queryKey: brandingKeys.doctors,
    queryFn: () => api<{ doctors: ReportDoctorItem[] }>("/lab/report-doctors").then((r) => r.doctors),
  });
}

/** How bills print: the default report letterhead, or the lab's own bill header, footer, heading and size. */
export function useBillSettings() {
  return useQuery({
    queryKey: brandingKeys.bill,
    queryFn: () => api<{ settings: BillSettings }>("/lab/bill-settings").then((r) => r.settings),
    placeholderData: DEFAULT_BILL_SETTINGS,
  });
}

export function useMyProfile() {
  return useQuery({ queryKey: brandingKeys.profile, queryFn: () => api<{ profile: MyProfile }>("/profile").then((r) => r.profile) });
}

/**
 * A stored image as a URL an <img> can show. Images need the access token, so
 * they're fetched as blobs. They never change (a new upload is a new id), so
 * each is fetched once per visit.
 */
export function useAssetUrl(id: string | null | undefined) {
  const { data } = useQuery({
    queryKey: brandingKeys.asset(id ?? ""),
    // A handful of small images per visit, so their object URLs are simply kept.
    queryFn: async () => URL.createObjectURL(await apiBlob(`/lab/assets/${id}`)),
    enabled: !!id,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  return id ? (data ?? null) : null;
}

const loadImage = (file: Blob) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file isn't an image we can read. Use a PNG or JPEG."));
    };
    img.src = url;
  });

const toPng = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't prepare the image"))), "image/png"));

/**
 * Prepares a photo or scan of a signature or stamp: the paper turns
 * transparent, the empty margin is trimmed, and it's scaled to a sensible
 * size. Done in the browser so the original photo never leaves the device.
 */
export async function cleanSignatureImage(file: Blob, { maxSide = 1000 } = {}): Promise<Blob> {
  const img = await loadImage(file);
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  const pixels = ctx.getImageData(0, 0, w, h);
  const d = pixels.data;
  let minX = w,
    minY = h,
    maxX = -1,
    maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const light = Math.min(d[i]!, d[i + 1]!, d[i + 2]!);
      // Near-white paper becomes transparent; light grey fades out so the ink keeps soft edges.
      if (light > 225) d[i + 3] = 0;
      else if (light > 170) d[i + 3] = Math.round(d[i + 3]! * ((225 - light) / 55));
      if (d[i + 3]! > 24) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error("The image looks blank. Sign on white paper with a dark pen and try again.");
  ctx.putImageData(pixels, 0, 0);
  const pad = 6;
  const cx = Math.max(0, minX - pad);
  const cy = Math.max(0, minY - pad);
  const cw = Math.min(w, maxX + pad + 1) - cx;
  const ch = Math.min(h, maxY + pad + 1) - cy;
  const out = document.createElement("canvas");
  out.width = cw;
  out.height = ch;
  out.getContext("2d")!.drawImage(canvas, cx, cy, cw, ch, 0, 0, cw, ch);
  return toPng(out);
}

/** Shrinks a large logo or letterhead image so it stays light in every PDF. Keeps PNGs as PNG. */
export async function shrinkImage(file: File, maxSide: number): Promise<Blob> {
  const img = await loadImage(file);
  if (Math.max(img.naturalWidth, img.naturalHeight) <= maxSide) return file;
  const scale = maxSide / Math.max(img.naturalWidth, img.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  if (file.type === "image/png") return toPng(canvas);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't prepare the image"))), "image/jpeg", 0.9));
}
