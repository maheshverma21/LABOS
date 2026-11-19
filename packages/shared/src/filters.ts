/**
 * Filters shared by the order-based lists (orders, reports, samples, results,
 * patients). Each is an id, or "none" for orders without one
 * (e.g. no referring doctor = self-referred, no account = walk-in).
 */
export interface ListFilters {
  doctorId?: string;
  accountId?: string;
  branchId?: string;
  testId?: string;
}

export const LIST_FILTER_KEYS = ["doctorId", "accountId", "branchId", "testId"] as const;
export type ListFilterKey = (typeof LIST_FILTER_KEYS)[number];

export const LIST_FILTER_LABEL: Record<ListFilterKey, string> = {
  doctorId: "Referring doctor",
  accountId: "B2B account",
  branchId: "Branch / collection centre",
  testId: "Test",
};

/** The value meaning "orders that have none of these". */
export const FILTER_NONE = "none";

/** Query-string pairs for the filters that are set. */
export function filterParams(f: ListFilters): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of LIST_FILTER_KEYS) if (f[k]) out[k] = f[k]!;
  return out;
}

export const activeFilterCount = (f: ListFilters) => LIST_FILTER_KEYS.filter((k) => !!f[k]).length;
