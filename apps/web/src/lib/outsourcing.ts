import { useQuery } from "@tanstack/react-query";
import type { OutsourceLabItem, OutsourceTestItem } from "@lms/shared";
import { api } from "./api";

export const outsourceKeys = {
  all: ["outsourcing"] as const,
  labs: ["outsourcing", "labs"] as const,
  tests: ["outsourcing", "tests"] as const,
};

export function useOutsourceLabs() {
  return useQuery({ queryKey: outsourceKeys.labs, queryFn: () => api<{ labs: OutsourceLabItem[] }>("/outsourcing/labs").then((r) => r.labs) });
}

export function useOutsourceTests() {
  return useQuery({ queryKey: outsourceKeys.tests, queryFn: () => api<{ tests: OutsourceTestItem[] }>("/outsourcing/tests").then((r) => r.tests) });
}
