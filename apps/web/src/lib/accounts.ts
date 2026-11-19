import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type {
  AccountDetail,
  AccountListItem,
  AccountNoteItem,
  DayBalanceRow,
  InvoiceDetail,
  InvoiceListItem,
  LabBalanceRow,
  LedgerResponse,
  WalletHistoryPage,
  WalletTxnKind,
} from "@lms/shared";
import { api } from "./api";

export const accountKeys = {
  all: ["accounts"] as const,
  list: (q: string, all: boolean) => [...accountKeys.all, "list", q, all] as const,
  detail: (id: string) => [...accountKeys.all, "detail", id] as const,
  invoices: (status: string, accountId: string) => [...accountKeys.all, "invoices", status, accountId] as const,
  invoice: (id: string, portal: boolean) => [...accountKeys.all, "invoice", id, portal] as const,
  wallet: (p: string) => [...accountKeys.all, "wallet", p] as const,
  ledger: (p: string) => [...accountKeys.all, "ledger", p] as const,
  days: (p: string) => [...accountKeys.all, "days", p] as const,
  labs: (p: string) => [...accountKeys.all, "labs", p] as const,
  notes: (p: string) => [...accountKeys.all, "notes", p] as const,
  priceList: (id: string) => [...accountKeys.all, "price-list", id] as const,
};

const qs = (o: Record<string, string | undefined>) => new URLSearchParams(Object.entries(o).filter((e): e is [string, string] => !!e[1])).toString();

export const useAccounts = (q = "", all = false, enabled = true) =>
  useQuery({
    queryKey: accountKeys.list(q, all),
    queryFn: () => api<{ accounts: AccountListItem[] }>(`/accounts?${qs({ q, all: all ? "1" : undefined })}`).then((r) => r.accounts),
    placeholderData: keepPreviousData,
    enabled,
  });

export const useAccount = (id: string, enabled = true) =>
  useQuery({ queryKey: accountKeys.detail(id), queryFn: () => api<{ account: AccountDetail }>(`/accounts/${id}`).then((r) => r.account), enabled });

export type InvoiceRow = InvoiceListItem & { account: { id: string; code: string; name: string } };

export const useInvoices = (status: string, accountId = "", portal = false) =>
  useQuery({
    queryKey: [...accountKeys.invoices(status, accountId), portal],
    queryFn: () => api<{ invoices: InvoiceRow[] }>(`${portal ? "/b2b" : ""}/invoices?${qs({ status, accountId })}`).then((r) => r.invoices),
  });

export const useInvoice = (id: string, portal = false) =>
  useQuery({
    queryKey: accountKeys.invoice(id, portal),
    queryFn: () => api<{ invoice: InvoiceDetail }>(`${portal ? "/b2b" : ""}/invoices/${id}`).then((r) => r.invoice),
  });

export interface Range {
  from: string;
  to: string;
}

/** Wallet entries: all labs (staff) or the signed-in client's own (portal). */
export const useWalletHistory = (r: Range, accountId = "", kind: WalletTxnKind | "" = "", portal = false) => {
  const p = `${r.from}|${r.to}|${accountId}|${kind}|${portal}`;
  return useQuery({
    queryKey: accountKeys.wallet(p),
    queryFn: () => api<WalletHistoryPage>(`${portal ? "/b2b" : "/accounts"}/wallet-history?${qs({ ...r, accountId: portal ? undefined : accountId, kind: portal ? undefined : kind })}`),
    placeholderData: keepPreviousData,
  });
};

export const useLedger = (r: Range, accountId: string, portal = false) =>
  useQuery({
    queryKey: accountKeys.ledger(`${r.from}|${r.to}|${accountId}|${portal}`),
    queryFn: () => api<{ ledger: LedgerResponse }>(`${portal ? "/b2b" : "/accounts"}/ledger?${qs({ ...r, accountId: portal ? undefined : accountId })}`).then((x) => x.ledger),
    enabled: portal || !!accountId,
    placeholderData: keepPreviousData,
  });

export const useDayBalances = (r: Range) =>
  useQuery({
    queryKey: accountKeys.days(`${r.from}|${r.to}`),
    queryFn: () => api<{ days: DayBalanceRow[] }>(`/accounts/balances/days?${qs({ ...r })}`).then((x) => x.days),
    placeholderData: keepPreviousData,
  });

export const useLabBalances = (r: Range) =>
  useQuery({
    queryKey: accountKeys.labs(`${r.from}|${r.to}`),
    queryFn: () => api<{ labs: LabBalanceRow[] }>(`/accounts/balances/labs?${qs({ ...r })}`).then((x) => x.labs),
    placeholderData: keepPreviousData,
  });

export const useNotes = (r: Range, accountId = "") =>
  useQuery({
    queryKey: accountKeys.notes(`${r.from}|${r.to}|${accountId}`),
    queryFn: () => api<{ notes: AccountNoteItem[] }>(`/accounts/notes?${qs({ ...r, accountId })}`).then((x) => x.notes),
    placeholderData: keepPreviousData,
  });

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
/** "4 Oct 2026" from "2026-10-04". */
export const fmtIsoDate = (iso: string) => dateFmt.format(new Date(`${iso}T00:00:00Z`));

const stampFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });
/** "4 Oct 2026, 03:15 pm" in IST, from an ISO instant. */
export const fmtStamp = (iso: string) => stampFmt.format(new Date(iso));
