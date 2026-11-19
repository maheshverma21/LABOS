import type { Access } from "../lib/access";
import type { TenantDb } from "../lib/tenant-db";

declare global {
  namespace Express {
    interface Request {
      /** Set by `authenticate`. */
      auth?: Access & { sessionId: string };
      /** Tenant-scoped Prisma client, set by `authenticate`. */
      db?: TenantDb;
    }
  }
}

export {};
