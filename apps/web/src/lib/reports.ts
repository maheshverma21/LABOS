import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { filterParams, type ListFilters, type ReportHeaderSettings, type ReportHeaderSettingsInput, type ReportListItem, type ReportStatus, type WhatsappSettings } from "@lms/shared";
import { api, apiBlob } from "./api";

export const reportKeys = {
  all: ["reports"] as const,
  list: (date: string, dateTo: string, q: string, filters: ListFilters) => [...reportKeys.all, "list", date, dateTo, q, filters] as const,
  status: (orderId: string) => [...reportKeys.all, "status", orderId] as const,
  whatsapp: () => [...reportKeys.all, "whatsapp-settings"] as const,
  header: () => [...reportKeys.all, "header-settings"] as const,
};

export function useReportList(date: string, dateTo: string, q: string, filters: ListFilters = {}) {
  return useQuery({
    queryKey: reportKeys.list(date, dateTo, q, filters),
    queryFn: () => api<{ reports: ReportListItem[] }>(`/reports?${new URLSearchParams({ date, dateTo, q, ...filterParams(filters) })}`).then((r) => r.reports),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
}

export function useReportStatus(orderId: string, enabled = true) {
  return useQuery({
    queryKey: reportKeys.status(orderId),
    queryFn: () => api<{ report: ReportStatus }>(`/reports/${orderId}`).then((r) => r.report),
    enabled,
  });
}

export function useWhatsappSettings(enabled = true) {
  return useQuery({
    queryKey: reportKeys.whatsapp(),
    queryFn: () => api<{ settings: WhatsappSettings }>("/reports/whatsapp-settings").then((r) => r.settings),
    enabled,
  });
}

/** Report settings: which details print at the top of every report. */
export function useReportHeaderSettings(enabled = true) {
  return useQuery({
    queryKey: reportKeys.header(),
    queryFn: () => api<{ settings: ReportHeaderSettings }>("/reports/header-settings").then((r) => r.settings),
    enabled,
  });
}

export function useSaveReportHeaderSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ReportHeaderSettingsInput) =>
      api<{ settings: ReportHeaderSettings }>("/reports/header-settings", { method: "PUT", body }).then((r) => r.settings),
    onSuccess: (settings) => qc.setQueryData(reportKeys.header(), settings),
  });
}

/**
 * Opens the order's report PDF in a new tab. The tab is opened straight away
 * (so pop-up blockers allow it) and pointed at the PDF once it has downloaded.
 */
export async function openReportPdf(orderId: string, filename: string, opts: { templateId?: string; letterhead?: boolean; outsource?: boolean; doctors?: string[]; separate?: boolean } = {}) {
  const tab = window.open("", "_blank");
  try {
    const qs = new URLSearchParams({ ...(opts.templateId ? { template: opts.templateId } : {}), ...(opts.letterhead === false ? { letterhead: "0" } : {}), ...(opts.outsource ? { outsource: "1" } : {}), ...(opts.doctors?.length ? { doctors: opts.doctors.join(",") } : {}), ...(opts.separate ? { separate: "1" } : {}) });
    const blob = await apiBlob(`/reports/${orderId}/pdf${qs.size ? `?${qs}` : ""}`);
    const url = URL.createObjectURL(blob);
    if (tab) tab.location.href = url;
    else {
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    tab?.close();
    throw err;
  }
}

export async function copyText(text: string) {
  await navigator.clipboard.writeText(text);
}
