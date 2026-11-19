"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PAYMENT_MODE_LABEL, PAYMENT_MODES, topUpSchema, type PaymentMode } from "@lms/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { MoneyInput } from "@/components/inputs/money-input";
import { api } from "@/lib/api";
import { accountKeys, useAccounts } from "@/lib/accounts";
import { LabPicker, Money } from "./lab-picker";

/** Money received from a lab, added to its wallet. */
export function AddMoneyDialog({ labId: initial, onClose }: { labId?: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [labId, setLabId] = useState(initial ?? "");
  const [mode, setMode] = useState<PaymentMode>("UPI");
  const [amount, setAmount] = useState<number | null>(null);
  const [reference, setReference] = useState("");
  const lab = useAccounts("", true).data?.find((l) => l.id === labId);

  const parsed = topUpSchema.safeParse({ accountId: labId, mode, amountPaise: amount ?? 0, reference });
  const add = useMutation({
    mutationFn: () => api("/accounts/top-up", { method: "POST", body: parsed.data }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: accountKeys.all });
      toast.success(`Added to ${lab?.name ?? "the wallet"}`);
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add money</DialogTitle>
          <DialogDescription>Record money received from a lab. It goes straight into the lab&apos;s wallet.</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="am-lab">B2B lab</FieldLabel>
            <LabPicker id="am-lab" value={labId} onChange={setLabId} className="w-full" />
            {lab && (
              <p className="text-xs text-muted-foreground">
                Wallet <Money paise={lab.walletPaise} /> · on hold <Money paise={lab.holdPaise} />
              </p>
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="am-amount">Amount</FieldLabel>
              <MoneyInput id="am-amount" value={amount} onChange={setAmount} />
            </Field>
            <Field>
              <FieldLabel htmlFor="am-mode">Paid by</FieldLabel>
              <Select value={mode} onValueChange={(v) => setMode(v as PaymentMode)}>
                <SelectTrigger id="am-mode" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_MODES.map((m) => (
                    <SelectItem key={m} value={m}>
                      {PAYMENT_MODE_LABEL[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="am-ref">Reference</FieldLabel>
            <Input id="am-ref" placeholder="UTR, cheque or transaction no. (optional)" value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button disabled={!parsed.success || add.isPending} onClick={() => add.mutate()}>
            {add.isPending && <Spinner />}
            Add money
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
