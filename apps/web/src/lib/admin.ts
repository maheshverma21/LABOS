import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type {
  AdminAuditItem,
  AdminLabDetail,
  AdminLabRow,
  AdminUserDetail,
  AdminUserRow,
  LabAccess,
  PlatformAdminItem,
  PlatformOverview,
} from "@lms/shared";
import { adminApi } from "./admin-api";

export const adminKeys = {
  all: ["admin"] as const,
  overview: () => [...adminKeys.all, "overview"] as const,
  labs: (q: string, plan: string, status: string) => [...adminKeys.all, "labs", q, plan, status] as const,
  lab: (id: string) => [...adminKeys.all, "lab", id] as const,
  users: (q: string, labId: string, role: string, status: string) => [...adminKeys.all, "users", q, labId, role, status] as const,
  user: (id: string) => [...adminKeys.all, "user", id] as const,
  audit: (labId: string) => [...adminKeys.all, "audit", labId] as const,
  admins: () => [...adminKeys.all, "admins"] as const,
  access: (id: string) => [...adminKeys.all, "access", id] as const,
};

const qs = (o: Record<string, string>) => new URLSearchParams(Object.entries(o).filter(([, v]) => v)).toString();

export const useOverview = () =>
  useQuery({ queryKey: adminKeys.overview(), queryFn: () => adminApi<{ overview: PlatformOverview }>("/overview").then((r) => r.overview) });

export const useAdminLabs = (q: string, plan: string, status: string) =>
  useQuery({
    queryKey: adminKeys.labs(q, plan, status),
    queryFn: () => adminApi<{ labs: AdminLabRow[] }>(`/labs?${qs({ q, plan, status })}`).then((r) => r.labs),
    placeholderData: keepPreviousData,
  });

export const useAdminLab = (id: string) =>
  useQuery({ queryKey: adminKeys.lab(id), queryFn: () => adminApi<{ lab: AdminLabDetail }>(`/labs/${id}`).then((r) => r.lab) });

export const useAdminUsers = (q: string, labId: string, role: string, status: string) =>
  useQuery({
    queryKey: adminKeys.users(q, labId, role, status),
    queryFn: () => adminApi<{ users: AdminUserRow[] }>(`/users?${qs({ q, labId, role, status })}`).then((r) => r.users),
    placeholderData: keepPreviousData,
  });

export const useAdminUser = (id: string) =>
  useQuery({ queryKey: adminKeys.user(id), queryFn: () => adminApi<{ user: AdminUserDetail }>(`/users/${id}`).then((r) => r.user) });

export const useAdminAudit = (labId: string) =>
  useQuery({
    queryKey: adminKeys.audit(labId),
    queryFn: () => adminApi<{ items: AdminAuditItem[] }>(`/audit?${qs({ labId })}`).then((r) => r.items),
  });

export const usePlatformAdmins = (enabled: boolean) =>
  useQuery({
    queryKey: adminKeys.admins(),
    queryFn: () => adminApi<{ admins: PlatformAdminItem[] }>("/admins").then((r) => r.admins),
    enabled,
  });

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
const dateTimeFmt = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
export const fmtDate = (iso: string | null) => (iso ? dateFmt.format(new Date(iso)) : "—");
export const fmtDateTime = (iso: string | null) => (iso ? dateTimeFmt.format(new Date(iso)) : "—");

/** "in 12 days", "3 days ago", "today". */
export function relativeDays(iso: string, now = new Date()) {
  const days = Math.round((new Date(iso).getTime() - now.getTime()) / 86_400_000);
  if (days === 0) return "today";
  return days > 0 ? `in ${days} day${days === 1 ? "" : "s"}` : `${-days} day${days === -1 ? "" : "s"} ago`;
}

/** Plain-English labels for audit actions. */
export const ACTION_LABEL: Record<string, string> = {
  "admin.login": "Signed in",
  "admin.login_failed": "Failed sign-in",
  "admin.refresh_reuse_detected": "Session reuse detected",
  "admin.create": "Added an admin",
  "admin.enable": "Enabled an admin",
  "admin.disable": "Disabled an admin",
  "lab.subscription": "Changed subscription",
  "user.enable": "Enabled user",
  "user.disable": "Disabled user",
  "user.sign_out": "Signed user out everywhere",
  "lab.access": "Changed lab access",
  "user.access": "Changed user roles",
  "user.temporary_password": "Set a temporary password",
  "user.reset_link": "Sent a password reset link",
  "admin.mfa_enabled": "Turned on two-step sign-in",
  "admin.mfa_reset": "Reset two-step sign-in",
};
export const actionLabel = (a: string) => ACTION_LABEL[a] ?? a.replace(/[._]/g, " ");

export const useLabAccess = (id: string) =>
  useQuery({ queryKey: adminKeys.access(id), queryFn: () => adminApi<{ access: LabAccess }>(`/labs/${id}/access`).then((r) => r.access) });
