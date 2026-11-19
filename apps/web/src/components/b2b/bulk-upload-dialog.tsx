"use client";

import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { DownloadIcon, UploadIcon } from "lucide-react";
import { rupeesToPaise, type BulkAccountsResult } from "@lms/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api";
import { accountKeys } from "@/lib/accounts";
import { parseCsv } from "@/lib/csv";
import { downloadCsv } from "@/lib/finance";

const COLUMNS = ["Code", "Name", "Type", "Contact Name", "Phone", "Email", "Address", "GSTIN", "Credit Limit", "Discount %", "Notes"];

/** Adds many labs from a CSV file. Rows with problems are reported; the rest are added. */
export function BulkUploadDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<BulkAccountsResult | null>(null);

  const read = async (file: File) => {
    const data = parseCsv(await file.text());
    const head = (data[0] ?? []).map((h) => h.trim().toLowerCase());
    const col = (name: string) => head.indexOf(name.toLowerCase());
    if (col("Code") < 0 || col("Name") < 0) return toast.error("The file needs Code and Name columns. Download the template for the right layout.");
    const cell = (r: string[], name: string) => (col(name) >= 0 ? (r[col(name)] ?? "").trim() : "");
    setRows(
      data.slice(1).map((r) => {
        const limit = cell(r, "Credit Limit").replace(/[₹,\s]/g, "");
        const discount = cell(r, "Discount %").replace(/[%\s]/g, "");
        return {
          code: cell(r, "Code"),
          name: cell(r, "Name"),
          type: cell(r, "Type").toUpperCase() || "LAB",
          contactName: cell(r, "Contact Name"),
          phone: cell(r, "Phone"),
          email: cell(r, "Email"),
          address: cell(r, "Address"),
          gstin: cell(r, "GSTIN"),
          // Blank means no limit; a number is rupees.
          creditLimitPaise: limit === "" ? null : Number.isFinite(Number(limit)) ? rupeesToPaise(Number(limit)) : -1,
          discountPercent: discount === "" ? 0 : Number(discount),
          notes: cell(r, "Notes"),
        };
      }),
    );
    setFileName(file.name);
    setResult(null);
  };

  const upload = useMutation({
    mutationFn: () => api<BulkAccountsResult>("/accounts/bulk", { method: "POST", body: { rows } }),
    onSuccess: async (r) => {
      setResult(r);
      await queryClient.invalidateQueries({ queryKey: accountKeys.all });
      if (r.errors.length === 0) {
        toast.success(`${r.created} ${r.created === 1 ? "lab" : "labs"} added`);
        onClose();
      }
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Bulk upload B2B labs</DialogTitle>
          <DialogDescription>Add many labs from a CSV file. Type is one of HOSPITAL, CLINIC, CORPORATE, LAB or OTHER; Credit Limit is in rupees (blank for no limit).</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => downloadCsv("b2b-labs-template.csv", COLUMNS, [["AXIS01", "Axis Lab", "LAB", "Mr Shah", "9820000000", "axis@example.com", "Andheri, Mumbai", "", 5000, 0, ""]])}
          >
            <DownloadIcon /> Download template
          </Button>
          <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
            <UploadIcon /> Choose file
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void read(f);
            }}
          />
        </div>
        {rows && (
          <p className="text-sm">
            {fileName}: <strong>{rows.length}</strong> {rows.length === 1 ? "row" : "rows"} ready.
          </p>
        )}
        {result && (
          <Alert variant={result.errors.length ? "destructive" : "default"}>
            <AlertDescription>
              <p>
                {result.created} added{result.errors.length ? `, ${result.errors.length} not added:` : "."}
              </p>
              {result.errors.length > 0 && (
                <ul className="mt-1 max-h-40 list-disc overflow-auto pl-5 text-xs">
                  {result.errors.map((e) => (
                    <li key={e.row}>
                      Row {e.row}: {e.message}
                    </li>
                  ))}
                </ul>
              )}
            </AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button disabled={!rows?.length || upload.isPending} onClick={() => upload.mutate()}>
            {upload.isPending && <Spinner />}
            Upload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

