import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type {
  InstrumentItem,
  InstrumentMappingItem,
  InstrumentMessageItem,
  InstrumentMessageStatus,
  InterfaceKeyItem,
  MappableParameter,
} from "@lms/shared";
import { api } from "./api";

export const instrumentKeys = {
  all: ["instruments"] as const,
  list: () => [...instrumentKeys.all, "list"] as const,
  keys: () => [...instrumentKeys.all, "keys"] as const,
  parameters: () => [...instrumentKeys.all, "parameters"] as const,
  mappings: (id: string) => [...instrumentKeys.all, "mappings", id] as const,
  messages: (id: string, status: string) => [...instrumentKeys.all, "messages", id, status] as const,
};

export const useInstruments = () =>
  useQuery({
    queryKey: instrumentKeys.list(),
    queryFn: () => api<{ instruments: InstrumentItem[] }>("/instruments").then((r) => r.instruments),
    // Keeps the "connected" dots current.
    refetchInterval: 30_000,
  });

export const useInterfaceKeys = () =>
  useQuery({ queryKey: instrumentKeys.keys(), queryFn: () => api<{ keys: InterfaceKeyItem[] }>("/instruments/keys").then((r) => r.keys) });

export const useMappableParameters = () =>
  useQuery({
    queryKey: instrumentKeys.parameters(),
    queryFn: () => api<{ parameters: MappableParameter[] }>("/instruments/parameters").then((r) => r.parameters),
    staleTime: 5 * 60_000,
  });

export type MappingData = { mappings: InstrumentMappingItem[]; unmapped: string[]; suggestions: { analyzerCode: string; parameterId: string }[] };

export const useInstrumentMappings = (id: string) =>
  useQuery({ queryKey: instrumentKeys.mappings(id), queryFn: () => api<MappingData>(`/instruments/${id}/mappings`) });

export const useInstrumentMessages = (id: string, status: InstrumentMessageStatus | "") =>
  useQuery({
    queryKey: instrumentKeys.messages(id, status),
    queryFn: () =>
      api<{ messages: InstrumentMessageItem[] }>(`/instruments/${id}/messages${status ? `?status=${status}` : ""}`).then((r) => r.messages),
    placeholderData: keepPreviousData,
    refetchInterval: 10_000,
  });

/** Heard from in the last two minutes (the interface program checks in every 30 s while connected). */
export const isOnline = (i: Pick<InstrumentItem, "lastSeenAt">) => !!i.lastSeenAt && Date.now() - new Date(i.lastSeenAt).getTime() < 120_000;
