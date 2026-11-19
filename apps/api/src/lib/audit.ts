import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { logger } from "./logger";

export interface AuditEntry {
  tenantId: string;
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  ip?: string | null;
  userAgent?: string | null;
}

/** Anything with auditLog.create: the base client, a transaction, or a tenant-scoped client. */
type Db = { auditLog: { create(args: { data: Prisma.AuditLogUncheckedCreateInput }): PromiseLike<unknown> } };

/**
 * Append an audit record. Pass a transaction client to make the audit row
 * part of the same transaction as the change it describes.
 */
export async function audit(entry: AuditEntry, db: Db = prisma): Promise<void> {
  try {
    await db.auditLog.create({ data: entry });
  } catch (err) {
    // An audit failure inside a transaction must fail the transaction.
    if ((db as unknown) !== prisma) throw err;
    logger.error({ err, action: entry.action }, "failed to write audit log");
  }
}
