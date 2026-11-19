"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { noteSchema } from "@lms/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { MoneyInput } from "@/components/inputs/money-input";
import { api } from "@/lib/api";
import { accountKeys, useAccounts } from "@/lib/accounts";
import { cn } from "@/lib/utils";
import { LabPicker, Money } from "./lab-picker";

/** A credit note adds money to a lab's wallet (a discount, a repeat test free); a debit note takes it (a charge). */
export function NoteDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<"CREDIT" | "DEBIT">("CREDIT");
  const [labId, setLabId] = useState("");
  const [amount, setAmount] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const lab = useAccounts("", true).data?.find((l) => l.id === labId);
  const parsed = noteSchema.safeParse({ accountId: labId, kind, amountPaise: amount ?? 0, reason });

  const create = useMutation({
    mutationFn: () => api<{ note: { noteNo: string } }>("/accounts/notes", { method: "POST", body: parsed.data }),
    onSuccess: async ({ note }) => {
      await queryClient.invalidateQueries({ queryKey: accountKeys.all });
      toast.success(`${note.noteNo} created`);
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New credit / debit note</DialogTitle>
          <DialogDescription>Adjust a lab&apos;s wallet with a numbered note that shows in its ledger.</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Note type">
            {(["CREDIT", "DEBIT"] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                onClick={() => setKind(k)}
                className={cn("rounded-lg border p-3 text-left text-sm", kind === k ? "border-primary bg-primary/5" : "text-muted-foreground")}
              >
                <div className="font-medium text-foreground">{k === "CREDIT" ? "Credit note" : "Debit note"}</div>
                <div className="text-xs">{k === "CREDIT" ? "Adds money to the wallet" : "Takes money from the wallet"}</div>
              </button>
            ))}
          </div>
          <Field>
            <FieldLabel htmlFor="note-lab">B2B lab</FieldLabel>
            <LabPicker id="note-lab" value={labId} onChange={setLabId} className="w-full" />
            {lab && (
              <p className="text-xs text-muted-foreground">
                Wallet now <Money paise={lab.walletPaise} />
              </p>
            )}
          </Field>
          <Field>
            <FieldLabel htmlFor="note-amount">Amount</FieldLabel>
            <MoneyInput id="note-amount" value={amount} onChange={setAmount} />
          </Field>
          <Field>
            <FieldLabel htmlFor="note-reason">Reason</FieldLabel>
            <Input id="note-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Repeat test free, courier charge" />
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button disabled={!parsed.success || create.isPending} onClick={() => create.mutate()}>
            {create.isPending && <Spinner />}
            Create note
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
