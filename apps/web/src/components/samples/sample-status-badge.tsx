import { SAMPLE_STATUS_LABEL, type SampleStatus } from "@lms/shared";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STYLE: Record<SampleStatus, string> = {
  PENDING: "border-amber-600/30 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400",
  COLLECTED: "border-sky-600/30 bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-400",
  RECEIVED: "border-emerald-600/30 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
  REJECTED: "border-red-600/30 bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400",
  CANCELLED: "text-muted-foreground line-through",
};

export function SampleStatusBadge({ status }: { status: SampleStatus }) {
  return (
    <Badge variant="outline" className={cn(STYLE[status])}>
      {SAMPLE_STATUS_LABEL[status]}
    </Badge>
  );
}
