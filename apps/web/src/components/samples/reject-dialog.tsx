"use client";

import { useState } from "react";
import { REJECT_REASONS } from "@lms/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useSampleActions } from "./use-sample-actions";

export function RejectSampleDialog({
  sample,
  onOpenChange,
}: {
  /** The sample to reject; null = closed. */
  sample: { id: string; barcode: string } | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [reason, setReason] = useState<string>("");
  const [note, setNote] = useState("");
  const { reject } = useSampleActions();

  return (
    <Dialog
      open={!!sample}
      onOpenChange={(open) => {
        if (open) {
          setReason("");
          setNote("");
        }
        onOpenChange(open);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reject sample {sample?.barcode}?</DialogTitle>
          <DialogDescription>
            Its tests move to a new tube with a new barcode, waiting to be collected again.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="reject-reason">Reason</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger id="reject-reason" className="w-full">
                <SelectValue placeholder="Pick a reason" />
              </SelectTrigger>
              <SelectContent>
                {REJECT_REASONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="reject-note">Note (optional)</Label>
            <Input id="reject-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Keep sample
          </Button>
          <Button
            variant="destructive"
            disabled={!reason || (reason === "Other" && !note.trim()) || reject.isPending}
            onClick={() =>
              sample && reject.mutate({ id: sample.id, reason, note }, { onSuccess: () => onOpenChange(false) })
            }
          >
            {reject.isPending && <Spinner />}
            Reject
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
