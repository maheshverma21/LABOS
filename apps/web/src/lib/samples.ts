import { filterParams, type ListFilters } from "@lms/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { SamplePage, SampleStatus } from "@lms/shared";
import { api } from "./api";

export const sampleKeys = {
  all: ["samples"] as const,
  list: (status: SampleStatus, date: string, dateTo: string, q: string, scope: string, filters: ListFilters = {}) => [...sampleKeys.all, status, date, dateTo, q, scope, filters] as const,
};

export function useSamples(status: SampleStatus, date: string, dateTo: string, q: string, scope: "branch" | "all", filters: ListFilters = {}) {
  return useQuery({
    queryKey: sampleKeys.list(status, date, dateTo, q, scope, filters),
    queryFn: () =>
      api<SamplePage>(`/samples?${new URLSearchParams({ status, date, dateTo, q, ...(scope === "branch" ? { scope } : {}), ...filterParams(filters) })}`),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
}
