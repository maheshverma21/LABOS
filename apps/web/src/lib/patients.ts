import { filterParams, type ListFilters } from "@lms/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  ageOn,
  formatAge,
  SEX_SHORT,
  type DoctorItem,
  type PatientDetail,
  type PatientListItem,
  type PatientPage,
} from "@lms/shared";
import { api } from "./api";

export const patientKeys = {
  all: ["patients"] as const,
  search: (q: string, page: number, filters: ListFilters = {}) => [...patientKeys.all, "search", q, page, filters] as const,
  byPhone: (phone: string) => [...patientKeys.all, "by-phone", phone] as const,
  detail: (id: string) => [...patientKeys.all, "detail", id] as const,
  doctors: (q: string, includeInactive: boolean) => ["doctors", q, includeInactive] as const,
};

export function usePatientSearch(q: string, page: number, pageSize = 25, filters: ListFilters = {}) {
  return useQuery({
    queryKey: patientKeys.search(q, page, filters),
    queryFn: () =>
      api<PatientPage>(`/patients?${new URLSearchParams({ q, page: String(page), pageSize: String(pageSize), ...filterParams(filters) })}`),
    placeholderData: keepPreviousData,
  });
}

/** Everyone registered on a mobile number (null phone = disabled). */
export function usePatientsByPhone(phone: string | null) {
  return useQuery({
    queryKey: patientKeys.byPhone(phone ?? ""),
    queryFn: () => api<{ patients: PatientListItem[] }>(`/patients/by-phone/${phone}`).then((r) => r.patients),
    enabled: !!phone,
    staleTime: 10_000,
  });
}

/** The ID the next registered patient will get (YYMMDD + the day's running number). */
export function useNextPatientId(enabled = true) {
  return useQuery({
    queryKey: [...patientKeys.all, "next-id"],
    queryFn: () => api<{ uhid: string }>("/patients/next-id").then((r) => r.uhid),
    enabled,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

export function usePatient(id: string) {
  return useQuery({
    queryKey: patientKeys.detail(id),
    queryFn: () => api<{ patient: PatientDetail }>(`/patients/${id}`).then((r) => r.patient),
    enabled: !!id,
  });
}

export function useDoctors(q = "", includeInactive = false) {
  return useQuery({
    queryKey: patientKeys.doctors(q, includeInactive),
    queryFn: () =>
      api<{ doctors: DoctorItem[] }>(
        `/doctors?${new URLSearchParams({ q, ...(includeInactive ? { includeInactive: "true" } : {}) })}`,
      ).then((r) => r.doctors),
    placeholderData: keepPreviousData,
  });
}

/** "35 Y / F", with "~" when the age was estimated. */
export function ageSex(p: Pick<PatientListItem, "dob" | "dobEstimated" | "sex">) {
  return `${p.dobEstimated ? "~" : ""}${formatAge(ageOn(p.dob))} / ${SEX_SHORT[p.sex]}`;
}

const dateFmt = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" });
/** "20 May 1990" from "1990-05-20" (no time-zone shift). */
export const formatDate = (iso: string) => dateFmt.format(new Date(`${iso.slice(0, 10)}T12:00:00`));
