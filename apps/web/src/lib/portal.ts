import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { PatientListItem, PortalOrderItem, PortalSummary } from "@lms/shared";
import { api, apiBlob } from "./api";

export interface PortalTest {
  id: string;
  code: string;
  name: string;
  isPanel: boolean;
  sampleType: string | null;
  tatHours: number | null;
  /** The lab's standard rate. */
  mrpPaise: number;
  /** The client's own price. */
  pricePaise: number;
  department: { id: string; name: string };
}

export const portalKeys = {
  all: ["portal"] as const,
  summary: () => [...portalKeys.all, "summary"] as const,
  orders: (p: string) => [...portalKeys.all, "orders", p] as const,
  catalog: () => [...portalKeys.all, "catalog"] as const,
  patients: (q: string) => [...portalKeys.all, "patients", q] as const,
};

export const usePortalSummary = () => useQuery({ queryKey: portalKeys.summary(), queryFn: () => api<{ summary: PortalSummary }>("/b2b/summary").then((r) => r.summary), refetchInterval: 60_000 });

export const usePortalOrders = (from: string, to: string, q: string) =>
  useQuery({
    queryKey: portalKeys.orders(`${from}|${to}|${q}`),
    queryFn: () => api<{ orders: PortalOrderItem[] }>(`/b2b/orders?${new URLSearchParams({ from, to, ...(q ? { q } : {}) })}`).then((r) => r.orders),
    placeholderData: keepPreviousData,
  });

export const usePortalCatalog = () => useQuery({ queryKey: portalKeys.catalog(), queryFn: () => api<{ tests: PortalTest[] }>("/b2b/catalog").then((r) => r.tests), staleTime: 5 * 60_000 });

export const usePortalPatients = (q: string) =>
  useQuery({
    queryKey: portalKeys.patients(q),
    queryFn: () => api<{ patients: PatientListItem[] }>(`/b2b/patients?${new URLSearchParams({ q })}`).then((r) => r.patients),
    placeholderData: keepPreviousData,
  });

/** Opens an authenticated PDF (report or labels) in a new tab. */
export async function openPortalPdf(path: string) {
  const blob = await apiBlob(path);
  window.open(URL.createObjectURL(blob), "_blank", "noopener");
}
