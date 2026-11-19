import Link from "next/link";
import type { AdminAuditItem } from "@lms/shared";
import { actionLabel, fmtDateTime } from "@/lib/admin";

const show = (v: unknown) => (v == null ? "—" : typeof v === "string" ? v : JSON.stringify(v));

/** What changed, in words: "plan STARTER → GROWTH", "reason: …". */
function Changes({ item }: { item: AdminAuditItem }) {
  const before = (item.before ?? {}) as Record<string, unknown>;
  const after = (item.after ?? {}) as Record<string, unknown>;
  const parts: string[] = [];
  for (const k of Object.keys(after)) {
    if (k === "reason") continue;
    if (k in before && show(before[k]) !== show(after[k])) parts.push(`${k} ${show(before[k])} → ${show(after[k])}`);
    else if (!(k in before) && item.action !== "lab.subscription") parts.push(`${k}: ${show(after[k])}`);
  }
  return (
    <>
      {parts.length > 0 && <div className="text-xs text-muted-foreground">{parts.join(" · ")}</div>}
      {typeof after.reason === "string" && <div className="text-xs">Reason: {after.reason}</div>}
    </>
  );
}

export function AuditList({ items, showLab = true, empty = "Nothing recorded yet." }: { items: AdminAuditItem[]; showLab?: boolean; empty?: string }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="divide-y rounded-lg border bg-background">
      {items.map((i) => (
        <li key={i.id} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-3 py-2.5 text-sm">
          <div className="w-40 shrink-0 text-xs text-muted-foreground">{fmtDateTime(i.createdAt)}</div>
          <div className="min-w-0 flex-1">
            <div>
              <span className="font-medium">{actionLabel(i.action)}</span>
              {showLab && i.lab && (
                <>
                  {" · "}
                  <Link href={`/admin/labs/${i.lab.id}`} className="hover:underline">
                    {i.lab.name}
                  </Link>
                </>
              )}
              {i.entityType === "user" && i.entityId && (
                <>
                  {" · "}
                  <Link href={`/admin/users/${i.entityId}`} className="hover:underline">
                    {(i.after as { email?: string } | null)?.email ?? "user"}
                  </Link>
                </>
              )}
            </div>
            <Changes item={i} />
          </div>
          <div className="text-xs text-muted-foreground">{i.admin ?? "Unknown admin"}</div>
        </li>
      ))}
    </ul>
  );
}
