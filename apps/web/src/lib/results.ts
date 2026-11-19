import { filterParams, type ListFilters } from "@lms/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ResultSheet, WorklistOrder } from "@lms/shared";
import { api } from "./api";

export type WorklistTab = "enter" | "approve" | "approved";

export const resultKeys = {
  all: ["results"] as const,
  worklist: (tab: WorklistTab, q: string, department: string, date: string, dateTo: string, filters: ListFilters = {}) =>
    [...resultKeys.all, "worklist", tab, q, department, date, dateTo, filters] as const,
  sheet: (orderId: string) => [...resultKeys.all, "sheet", orderId] as const,
};

export function useWorklist(tab: WorklistTab, q: string, department: string, date: string, dateTo: string, filters: ListFilters = {}) {
  return useQuery({
    queryKey: resultKeys.worklist(tab, q, department, date, dateTo, filters),
    queryFn: () =>
      api<{ orders: WorklistOrder[] }>(`/results/worklist?${new URLSearchParams({ tab, q, department, date, dateTo, ...filterParams(filters) })}`).then((r) => r.orders),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
}

export function useSheet(orderId: string) {
  return useQuery({
    queryKey: resultKeys.sheet(orderId),
    queryFn: () => api<{ sheet: ResultSheet }>(`/results/orders/${orderId}`).then((r) => r.sheet),
  });
}
