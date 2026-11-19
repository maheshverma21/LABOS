import { filterParams, type ListFilters } from "@lms/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { CollectionsSummary, LabProfile, OrderDetail, OrderPage, PaymentStatus } from "@lms/shared";
import { api } from "./api";

export const orderKeys = {
  all: ["orders"] as const,
  list: (f: OrderFilters) => [...orderKeys.all, "list", f] as const,
  detail: (id: string) => [...orderKeys.all, "detail", id] as const,
  collections: (date: string, dateTo: string, branchId: string) => ["collections", date, dateTo, branchId] as const,
  lab: ["lab"] as const,
};

export interface OrderFilters {
  q?: string;
  date?: string;
  dateTo?: string;
  status?: "" | "due" | "cancelled";
  patientId?: string;
  page?: number;
  pageSize?: number;
  filters?: ListFilters;
}

export function useOrders(f: OrderFilters, enabled = true) {
  return useQuery({
    queryKey: orderKeys.list(f),
    queryFn: () => {
      const { filters, ...rest } = f;
      const qs = new URLSearchParams(filterParams(filters ?? {}));
      for (const [k, v] of Object.entries(rest)) if (v !== undefined && v !== "") qs.set(k, String(v));
      return api<OrderPage>(`/orders?${qs}`);
    },
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useOrder(id: string, portal = false) {
  return useQuery({
    queryKey: [...orderKeys.detail(id), portal],
    queryFn: () => api<{ order: OrderDetail }>(`${portal ? "/b2b" : ""}/orders/${id}`).then((r) => r.order),
  });
}

export function useLab() {
  return useQuery({ queryKey: orderKeys.lab, queryFn: () => api<{ lab: LabProfile }>("/lab").then((r) => r.lab) });
}

export function useCollections(date: string, dateTo: string, branchId: string) {
  return useQuery({
    queryKey: orderKeys.collections(date, dateTo, branchId),
    queryFn: () =>
      api<CollectionsSummary>(`/billing/collections?${new URLSearchParams({ date, dateTo, ...(branchId ? { branchId } : {}) })}`),
    placeholderData: keepPreviousData,
  });
}

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  PAID: "Paid",
  PARTIAL: "Part paid",
  UNPAID: "Unpaid",
  CANCELLED: "Cancelled",
  ON_ACCOUNT: "On account",
};

const timeFmt = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
const dateTimeFmt = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});
const dayFmt = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" });
export const formatDay = (iso: string) => dayFmt.format(new Date(iso));
export const formatTime = (iso: string) => timeFmt.format(new Date(iso));
export const formatDateTime = (iso: string) => dateTimeFmt.format(new Date(iso));
