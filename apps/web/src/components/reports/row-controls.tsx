"use client";

import { ChevronDownIcon, FileTextIcon, PencilIcon, PrinterIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Preview } from "@/components/reports/preview-dialog";
import { useTemplates } from "@/lib/branding";

/** One "Action" menu per row: view and print the bill or the report. */
export function Actions({
  r,
  onPreview,
}: {
  r: { approvedTests: number };
  onPreview: (p: Preview) => void;
}) {
  const { data: templates } = useTemplates();
  const ready = r.approvedTests > 0;
  const others = (templates ?? []).filter((t) => !t.isDefault);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          Action <ChevronDownIcon className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuItem onSelect={() => onPreview({ kind: "bill" })}>
          <PrinterIcon /> Bill
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!ready}
          onSelect={() => onPreview({ kind: "report", opts: {} })}
        >
          <FileTextIcon /> Report with letterhead
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!ready}
          onSelect={() =>
            onPreview({ kind: "report", opts: { letterhead: false } })
          }
        >
          <FileTextIcon /> Report without letterhead
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!ready}
          onSelect={() => onPreview({ kind: "report", opts: { outsource: true } })}
        >
          <FileTextIcon /> Outsource report
        </DropdownMenuItem>
        {ready &&
          others.map((t) => (
            <DropdownMenuItem
              key={t.id}
              onSelect={() =>
                onPreview({ kind: "report", opts: { templateId: t.id } })
              }
            >
              Report on {t.name}
            </DropdownMenuItem>
          ))}
        {!ready && (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            Report is available once a test is approved.
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Barcode number(s) of the order's samples, with a button that prints the barcode labels. */
export function BarcodePrint({
  r,
  onPreview,
  onEdit,
}: {
  r: { barcodes: string[] };
  onPreview: (p: Preview) => void;
  onEdit: () => void;
}) {
  const none = r.barcodes.length === 0;
  return (
    <div className="flex items-center gap-1.5">
      <div className="font-mono text-xs">
        {none ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          r.barcodes.map((b) => <div key={b}>{b}</div>)
        )}
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Edit barcode"
        title={none ? "No barcode" : "Edit barcode"}
        disabled={none}
        onClick={onEdit}
      >
        <PencilIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Print barcode"
        title={none ? "No barcode" : "Print barcode"}
        disabled={none}
        onClick={() => onPreview({ kind: "barcode" })}
      >
        <PrinterIcon />
      </Button>
    </div>
  );
}

