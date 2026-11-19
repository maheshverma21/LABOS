import type { PaymentStatus } from "@lms/shared";
import { Badge } from "@/components/ui/badge";
import { PAYMENT_STATUS_LABEL } from "@/lib/orders";
import { cn } from "@/lib/utils";

const STYLE: Record<PaymentStatus, string> = {
  PAID: "border-emerald-600/30 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
  PARTIAL: "border-amber-600/30 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400",
  UNPAID: "border-red-600/30 bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400",
  CANCELLED: "text-muted-foreground line-through",
  ON_ACCOUNT: "border-sky-600/30 bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300",
};

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return (
    <Badge variant="outline" className={cn(STYLE[status])}>
      {PAYMENT_STATUS_LABEL[status]}
    </Badge>
  );
}
