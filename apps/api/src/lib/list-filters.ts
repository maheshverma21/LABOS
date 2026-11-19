import type { Prisma } from "@prisma/client";
import { FILTER_NONE, LIST_FILTER_KEYS, type ListFilters } from "@lms/shared";
import { badRequest } from "./errors";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads ?doctorId=&accountId=&branchId=&testId= from a request's query. */
export function parseListFilters(query: Record<string, unknown>): ListFilters {
  const f: ListFilters = {};
  for (const k of LIST_FILTER_KEYS) {
    const v = query[k];
    if (typeof v !== "string" || !v) continue;
    // Tests always have one; "none" only makes sense for the optional links.
    if (!(UUID.test(v) || (v === FILTER_NONE && k !== "testId"))) throw badRequest(`Unknown ${k}`);
    f[k] = v;
  }
  return f;
}

const link = (v: string | undefined) => (v === FILTER_NONE ? null : v);

/** The filters as conditions on an order. Tests match when the order includes that test. */
export function orderFilterWhere(f: ListFilters, { tests = true } = {}): Prisma.OrderWhereInput {
  const where: Prisma.OrderWhereInput = {};
  if (f.doctorId) where.doctorId = link(f.doctorId);
  if (f.accountId) where.accountId = link(f.accountId);
  if (f.branchId) where.branchId = link(f.branchId);
  if (tests && f.testId) where.tests = { some: { testId: f.testId, status: { not: "CANCELLED" } } };
  return where;
}

export const hasFilters = (f: ListFilters) => LIST_FILTER_KEYS.some((k) => !!f[k]);
