"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PrinterIcon } from "lucide-react";
import { SAMPLE_BARCODE_PATTERN } from "@lms/shared";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/api";
import { orderKeys, useOrder } from "@/lib/orders";
import { reportKeys } from "@/lib/reports";
import { sampleKeys } from "@/lib/samples";

/**
 * Edit the barcode of each tube of an order and print the labels. Tubes whose
 * barcode was changed are saved first, then the labels open for printing.
 */
export function BarcodeEditDialog({
  orderId,
  orderNo,
  onClose,
  onPrint,
}: {
  orderId: string;
  orderNo: string;
  onClose: () => void;
  onPrint: (ids: string[]) => void;
}) {
  const queryClient = useQueryClient();
  const { data: order, error } = useOrder(orderId);
  const samples = (order?.samples ?? []).filter(
    (s) => s.status !== "CANCELLED" && s.status !== "REJECTED",
  );
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const value = (id: string, saved: string) => drafts[id] ?? saved;
  const invalid = (id: string, saved: string) =>
    !SAMPLE_BARCODE_PATTERN.test(value(id, saved).trim());

  /** Saves the changed barcodes among `ids`, then opens the labels. */
  async function printIds(ids: string[]) {
    const changed = samples.filter(
      (s) =>
        ids.includes(s.id) &&
        value(s.id, s.barcode).trim().toUpperCase() !== s.barcode,
    );
    if (changed.some((s) => invalid(s.id, s.barcode))) {
      toast.error("Barcodes need 4 to 32 letters, numbers or dashes");
      return;
    }
    setBusy(true);
    try {
      for (const s of changed) {
        await api(`/samples/${s.id}/barcode`, {
          method: "PUT",
          body: { barcode: value(s.id, s.barcode).trim() },
        });
      }
      if (changed.length) {
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: orderKeys.detail(orderId),
          }),
          queryClient.invalidateQueries({ queryKey: reportKeys.all }),
          queryClient.invalidateQueries({ queryKey: sampleKeys.all }),
        ]);
      }
      onPrint(ids);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't save the barcode",
      );
      await queryClient.invalidateQueries({
        queryKey: orderKeys.detail(orderId),
      });
    } finally {
      setBusy(false);
    }
  }

  const allPicked =
    samples.length > 0 && samples.every((s) => picked.has(s.id));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="gap-4 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Print Bar Code</DialogTitle>
          <DialogDescription>
            Edit a barcode if needed, then print. Lab no. {orderNo}.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    aria-label="Select all"
                    checked={allPicked}
                    onCheckedChange={(v) =>
                      setPicked(
                        v === true
                          ? new Set(samples.map((s) => s.id))
                          : new Set(),
                      )
                    }
                  />
                </TableHead>
                <TableHead>Test Name</TableHead>
                <TableHead>Sample Type</TableHead>
                <TableHead className="w-52">Barcode</TableHead>
                <TableHead className="w-24">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!order && !error && (
                <TableRow>
                  <TableCell colSpan={5}>
                    <Skeleton className="h-5 w-full" />
                  </TableCell>
                </TableRow>
              )}
              {error && (
                <TableRow>
                  <TableCell colSpan={5} className="text-destructive">
                    {error.message}
                  </TableCell>
                </TableRow>
              )}
              {samples.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <Checkbox
                      aria-label={`Select ${s.barcode}`}
                      checked={picked.has(s.id)}
                      onCheckedChange={(v) =>
                        setPicked((p) => {
                          const n = new Set(p);
                          if (v === true) n.add(s.id);
                          else n.delete(s.id);
                          return n;
                        })
                      }
                    />
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    {s.tests.map((t) => t.name).join(", ")}
                  </TableCell>
                  <TableCell>{s.container ?? s.sampleType}</TableCell>
                  <TableCell>
                    <Input
                      aria-label="Barcode"
                      className="font-mono"
                      value={value(s.id, s.barcode)}
                      aria-invalid={invalid(s.id, s.barcode)}
                      maxLength={32}
                      onChange={(e) =>
                        setDrafts((d) => ({ ...d, [s.id]: e.target.value }))
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => printIds([s.id])}
                    >
                      <PrinterIcon /> Print
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="flex justify-end">
          <Button
            disabled={busy || picked.size === 0}
            onClick={() =>
              printIds(samples.filter((s) => picked.has(s.id)).map((s) => s.id))
            }
          >
            {busy ? <Spinner /> : <PrinterIcon />} Print
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
