"use client";

import { DEFAULT_TEMPLATE } from "@lms/shared";
import { cn } from "@/lib/utils";
import { useAssetUrl, useBillSettings, useTemplates } from "@/lib/branding";
import { useLab } from "@/lib/orders";

/**
 * "With letterhead" or "without" for printed bills and invoices. Pages start
 * from ?letterhead=0 in the link, and it can be switched before printing.
 */
export function LetterheadToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div role="radiogroup" aria-label="Letterhead" className="flex rounded-lg border bg-background p-0.5 text-sm">
      {[
        { v: true, label: "With letterhead" },
        { v: false, label: "Without letterhead" },
      ].map((o) => (
        <button
          key={o.label}
          type="button"
          role="radio"
          aria-checked={value === o.v}
          onClick={() => onChange(o.v)}
          className={cn("rounded-md px-3 py-1.5", value === o.v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The top of a printed bill. With the letterhead it shows the lab's default
 * letterhead: the uploaded header image, or `children` (the lab's details)
 * with the logo. Without, it leaves the same height blank for letterhead paper.
 */
export function PrintLetterhead({ on, title, bill = false, children }: { on: boolean; title: React.ReactNode; bill?: boolean; children: React.ReactNode }) {
  const { data: templates } = useTemplates();
  const { data: bs } = useBillSettings();
  const own = bill && bs?.custom ? bs : null;
  const ownHeader = useAssetUrl(own?.headerImageId);
  const { data: lab } = useLab();
  const t = templates?.find((x) => x.isDefault) ?? DEFAULT_TEMPLATE;
  const header = useAssetUrl(t.style === "IMAGE" ? t.headerImageId : null);
  const logo = useAssetUrl(t.showLogo ? lab?.logoId : null);

  // Bills with their own settings ignore the report letterhead (and its background) altogether.
  if (own) {
    if (!on) {
      return (
        <div className="flex items-end justify-end border-b-2 border-black pb-3" style={{ minHeight: `${own.headerHeightMm}mm` }}>
          <div className="text-right">{title}</div>
        </div>
      );
    }
    if (ownHeader) {
      return (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- a blob URL from the API */}
          <img src={ownHeader} alt="" className="w-full object-contain" style={{ height: `${own.headerHeightMm}mm` }} />
          <div className="flex justify-end border-b-2 border-black pb-3">
            <div className="text-right">{title}</div>
          </div>
        </>
      );
    }
  }
  if (!on && !own) {
    return (
      <div className="flex items-end justify-end border-b-2 border-black pb-3" style={{ minHeight: `${t.headerHeightMm}mm` }}>
        <div className="text-right">{title}</div>
      </div>
    );
  }
  if (!own && t.style === "IMAGE" && header) {
    return (
      <>
        {/* eslint-disable-next-line @next/next/no-img-element -- a blob URL from the API */}
        <img src={header} alt="" className="w-full object-contain" style={{ height: `${t.headerHeightMm}mm` }} />
        <div className="flex justify-end border-b-2 border-black pb-3">
          <div className="text-right">{title}</div>
        </div>
      </>
    );
  }
  return (
    <header className="flex items-start justify-between gap-6 border-b-2 pb-3" style={{ borderColor: t.accentColor }}>
      <div className="flex items-start gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- a blob URL from the API */}
        {logo && <img src={logo} alt="" className="max-h-16 max-w-32 object-contain" />}
        <div>{children}</div>
      </div>
      <div className="text-right">{title}</div>
    </header>
  );
}

/** The bottom of a printed bill: the letterhead's footer image, or blank space without the letterhead. */
export function PrintLetterheadFooter({ on, bill = false }: { on: boolean; bill?: boolean }) {
  const { data: templates } = useTemplates();
  const { data: bs } = useBillSettings();
  const own = bill && bs?.custom ? bs : null;
  const t = templates?.find((x) => x.isDefault) ?? DEFAULT_TEMPLATE;
  const footer = useAssetUrl(on ? (own ? own.footerImageId : t.style === "IMAGE" ? t.footerImageId : null) : null);
  const height = own ? own.footerHeightMm : t.footerHeightMm;
  if (!on) return height > 0 ? <div aria-hidden style={{ height: `${height}mm` }} /> : null;
  if (!footer) return null;
  // eslint-disable-next-line @next/next/no-img-element -- a blob URL from the API
  return <img src={footer} alt="" className="mt-6 w-full object-contain" style={{ height: `${height}mm` }} />;
}
