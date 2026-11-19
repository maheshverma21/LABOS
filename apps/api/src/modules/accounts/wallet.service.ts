import type { PaymentMode, WalletTxnKind } from "@lms/shared";
import type { TenantDb } from "../../lib/tenant-db";
import { AppError } from "../../lib/errors";

/**
 * A B2B lab's prepaid wallet.
 *
 *  - wallet: money the lab has paid in, minus what has been taken. Negative once it uses its credit.
 *  - hold:   money reserved for orders the lab has placed but whose tubes haven't reached our lab yet.
 *  - net:    wallet - hold. The lab can keep ordering while net + credit limit stays at or above zero.
 *
 * An order is held when it is placed, taken from the wallet when the first tube is received, and
 * given back if it is cancelled. Every change to the wallet leaves a WalletTxn row.
 */
/** A transaction opened through the tenant-scoped client (or the plain one). */
export type Tx = Parameters<Parameters<TenantDb["$transaction"]>[0]>[0];

/** The "Registration access below credit limit at B2B lab" switch: when off, the credit limit isn't enforced. */
export const limitEnforced = (settings: unknown) => (settings as { registrationBelowCreditB2b?: boolean } | null)?.registrationBelowCreditB2b !== false;

export const inr = (p: number) => `${p < 0 ? "-" : ""}₹${(Math.abs(p) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

function creditError(name: string, available: number, wanted: number, limit: number) {
  return new AppError(
    409,
    "credit_limit",
    `${name} can't place this order: it needs ${inr(wanted)} but only ${inr(Math.max(available, 0))} is available (credit limit ${inr(limit)}). Add money to the wallet or raise the limit.`,
  );
}

/** Checks, before anything is written, that an extra `addPaise` of orders fits. */
export async function assertCredit(
  db: TenantDb,
  account: { id: string; name: string; creditLimitPaise: number | null },
  addPaise: number,
) {
  if (account.creditLimitPaise == null || addPaise <= 0) return;
  const a = await db.account.findFirst({ where: { id: account.id }, select: { walletPaise: true, holdPaise: true, settings: true } });
  if (a && !limitEnforced(a.settings)) return;
  const available = (a?.walletPaise ?? 0) - (a?.holdPaise ?? 0) + account.creditLimitPaise;
  if (addPaise > available) throw creditError(account.name, available, addPaise, account.creditLimitPaise);
}

interface Move {
  tenantId: string;
  accountId: string;
  wallet?: number;
  hold?: number;
  /** Writes a ledger row for the wallet change. */
  txn?: { kind: WalletTxnKind; mode?: PaymentMode | null; reference?: string | null; narration?: string | null; orderId?: string | null; noteId?: string | null; createdById?: string | null };
}

/** Changes the wallet and hold in one atomic step, refusing a move that would break the credit limit. */
export async function move(tx: Tx, m: Move) {
  const wallet = m.wallet ?? 0;
  const hold = m.hold ?? 0;
  const a = await tx.account.update({
    where: { id: m.accountId },
    data: { walletPaise: { increment: wallet }, holdPaise: { increment: hold } },
    select: { name: true, walletPaise: true, holdPaise: true, creditLimitPaise: true, settings: true },
  });
  // Only a move that lowers what the lab can spend is checked, so settling or refunding never fails.
  if (wallet - hold < 0 && a.creditLimitPaise != null && limitEnforced(a.settings)) {
    const available = a.walletPaise - a.holdPaise + a.creditLimitPaise;
    if (available < 0) throw creditError(a.name, available - (wallet - hold), -(wallet - hold), a.creditLimitPaise);
  }
  if (m.txn && wallet !== 0) {
    await tx.walletTxn.create({
      data: {
        tenantId: m.tenantId,
        accountId: m.accountId,
        kind: m.txn.kind,
        amountPaise: wallet,
        balanceAfterPaise: a.walletPaise,
        mode: m.txn.mode ?? null,
        reference: m.txn.reference ?? null,
        narration: m.txn.narration ?? null,
        orderId: m.txn.orderId ?? null,
        noteId: m.txn.noteId ?? null,
        createdById: m.txn.createdById ?? null,
      },
    });
  }
  return a;
}

export interface ChargedOrder {
  id: string;
  accountId: string | null;
  chargePaise: number;
  chargeSettled: boolean;
}

/** An order placed for a lab: reserve its amount. Call inside the transaction that creates the order. */
export async function holdOrder(tx: Tx, tenantId: string, orderId: string, accountId: string, amountPaise: number) {
  await move(tx, { tenantId, accountId, hold: amountPaise });
  await tx.order.update({ where: { id: orderId }, data: { chargePaise: amountPaise, chargeSettled: false } });
}

/** The order's amount changed (tests added): reserve or take the difference. */
export async function adjustOrder(tx: Tx, tenantId: string, order: ChargedOrder, newAmountPaise: number, by: string | null, orderNo: string) {
  if (!order.accountId) return;
  const delta = newAmountPaise - order.chargePaise;
  if (delta === 0) return;
  if (order.chargeSettled) {
    await move(tx, { tenantId, accountId: order.accountId, wallet: -delta, txn: { kind: delta > 0 ? "ORDER" : "REFUND", orderId: order.id, createdById: by, narration: `Order ${orderNo} ${delta > 0 ? "tests added" : "amount reduced"}` } });
  } else {
    await move(tx, { tenantId, accountId: order.accountId, hold: delta });
  }
  await tx.order.update({ where: { id: order.id }, data: { chargePaise: newAmountPaise } });
}

/** An order cancelled: release its hold, or give back what was taken. */
export async function releaseOrder(tx: Tx, tenantId: string, order: ChargedOrder, by: string | null, orderNo: string) {
  if (!order.accountId || order.chargePaise === 0) return;
  // Claim first, so a concurrent receive can't also settle it.
  const claimed = await tx.order.updateMany({
    where: { id: order.id, chargePaise: order.chargePaise, chargeSettled: order.chargeSettled },
    data: { chargePaise: 0, chargeSettled: false },
  });
  if (claimed.count === 0) throw new AppError(409, "conflict", "This order just changed. Refresh and try again.");
  if (order.chargeSettled) {
    await move(tx, { tenantId, accountId: order.accountId, wallet: order.chargePaise, txn: { kind: "REFUND", orderId: order.id, createdById: by, narration: `Order ${orderNo} cancelled` } });
  } else {
    await move(tx, { tenantId, accountId: order.accountId, hold: -order.chargePaise });
  }
}

/** The lab's first tube for these orders arrived: turn the hold into a charge on the wallet. */
export async function settleOrders(tx: Tx, tenantId: string, orderIds: string[], by: string | null) {
  if (orderIds.length === 0) return;
  const orders = await tx.order.findMany({
    where: { id: { in: orderIds }, accountId: { not: null }, chargeSettled: false, chargePaise: { gt: 0 }, status: "ACTIVE" },
    select: { id: true, orderNo: true, accountId: true, chargePaise: true },
  });
  for (const o of orders) {
    const claimed = await tx.order.updateMany({ where: { id: o.id, chargeSettled: false }, data: { chargeSettled: true } });
    if (claimed.count === 0) continue;
    await move(tx, {
      tenantId,
      accountId: o.accountId!,
      wallet: -o.chargePaise,
      hold: -o.chargePaise,
      txn: { kind: "ORDER", orderId: o.id, createdById: by, narration: `Order ${o.orderNo}` },
    });
  }
}
