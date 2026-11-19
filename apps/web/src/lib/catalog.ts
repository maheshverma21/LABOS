import { useQuery } from "@tanstack/react-query";
import type { DepartmentItem, PriceListSummary, TestDetail, TestListItem } from "@lms/shared";
import { api } from "./api";

export const catalogKeys = {
  all: ["catalog"] as const,
  departments: () => [...catalogKeys.all, "departments"] as const,
  tests: (filters: { search?: string; departmentId?: string; includeInactive?: boolean }) =>
    [...catalogKeys.all, "tests", filters] as const,
  test: (id: string) => [...catalogKeys.all, "test", id] as const,
  priceLists: () => [...catalogKeys.all, "price-lists"] as const,
  priceList: (id: string) => [...catalogKeys.all, "price-list", id] as const,
};

export function useDepartments() {
  return useQuery({
    queryKey: catalogKeys.departments(),
    queryFn: () => api<{ departments: DepartmentItem[] }>("/catalog/departments").then((r) => r.departments),
  });
}

export function useTests(filters: { search?: string; departmentId?: string; includeInactive?: boolean } = {}) {
  return useQuery({
    queryKey: catalogKeys.tests(filters),
    queryFn: () => {
      const qs = new URLSearchParams();
      if (filters.search) qs.set("search", filters.search);
      if (filters.departmentId) qs.set("departmentId", filters.departmentId);
      if (filters.includeInactive) qs.set("includeInactive", "true");
      return api<{ tests: TestListItem[] }>(`/catalog/tests?${qs}`).then((r) => r.tests);
    },
    placeholderData: (prev) => prev,
  });
}

export function useTest(id: string) {
  return useQuery({
    queryKey: catalogKeys.test(id),
    queryFn: () => api<{ test: TestDetail }>(`/catalog/tests/${id}`).then((r) => r.test),
  });
}

export function usePriceLists() {
  return useQuery({
    queryKey: catalogKeys.priceLists(),
    queryFn: () => api<{ priceLists: PriceListSummary[] }>("/catalog/price-lists").then((r) => r.priceLists),
  });
}
