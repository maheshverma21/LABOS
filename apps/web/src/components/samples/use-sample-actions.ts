"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ReceiveResult, SampleItem } from "@lms/shared";
import { api } from "@/lib/api";
import { orderKeys } from "@/lib/orders";
import { sampleKeys } from "@/lib/samples";

/** Collect / receive / reject, refreshing every list and order that shows samples. */
export function useSampleActions() {
  const queryClient = useQueryClient();
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: sampleKeys.all });
    await queryClient.invalidateQueries({ queryKey: orderKeys.all });
  };

  const collect = useMutation({
    mutationFn: (sampleIds: string[]) => api<{ samples: SampleItem[] }>("/samples/collect", { method: "POST", body: { sampleIds } }),
    onSuccess: async ({ samples }) => {
      toast.success(samples.length === 1 ? `Collected ${samples[0]!.barcode}` : `Collected ${samples.length} samples`);
      await refresh();
    },
    onError: (err) => toast.error(err.message),
  });

  const receive = useMutation({
    mutationFn: (input: { barcodes?: string[]; sampleIds?: string[] }) =>
      api<ReceiveResult>("/samples/receive", { method: "POST", body: { barcodes: [], sampleIds: [], ...input } }),
    onSuccess: async (r) => {
      for (const s of r.received) toast.success(`Received ${s.barcode} · ${s.order.patient.name}`);
      for (const p of r.problems) toast.error(`${p.barcode}: ${p.message}`);
      await refresh();
    },
    onError: (err) => toast.error(err.message),
  });

  const reject = useMutation({
    mutationFn: ({ id, reason, note }: { id: string; reason: string; note: string }) =>
      api<{ rejected: SampleItem; replacement: SampleItem }>(`/samples/${id}/reject`, {
        method: "POST",
        body: { reason, note: note || null },
      }),
    onSuccess: async ({ replacement }) => {
      toast.success(`Rejected. Recollect as ${replacement.barcode} and print a new label.`);
      await refresh();
    },
    onError: (err) => toast.error(err.message),
  });

  return { collect, receive, reject };
}
