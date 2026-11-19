import { ORDER_TEST_STATUS_LABEL, type OrderTestStatus } from "@lms/shared";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STYLE: Record<OrderTestStatus, string> = {
  AWAITING_SAMPLE: "text-muted-foreground",
  IN_LAB: "border-sky-600/30 bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-400",
  ENTERED: "border-amber-600/30 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400",
  SUBMITTED: "border-violet-600/30 bg-violet-50 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300",
  APPROVED: "border-emerald-600/30 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
  CANCELLED: "text-muted-foreground line-through",
};

/** Coloured by status; shows the status name unless given other content (e.g. a test code). */
export function TestStatusBadge({
  status,
  className,
  children,
}: {
  status: OrderTestStatus;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <Badge variant="outline" className={cn(STYLE[status], className)} title={children ? ORDER_TEST_STATUS_LABEL[status] : undefined}>
      {children ?? ORDER_TEST_STATUS_LABEL[status]}
    </Badge>
  );
}
