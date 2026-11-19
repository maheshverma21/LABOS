import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

/** Models that belong to a tenant. Every query on them is scoped automatically. */
const TENANT_MODELS = new Set<string>([
  Prisma.ModelName.Branch,
  Prisma.ModelName.User,
  Prisma.ModelName.Role,
  Prisma.ModelName.UserRole,
  Prisma.ModelName.Session,
  Prisma.ModelName.AuditLog,
  Prisma.ModelName.Department,
  Prisma.ModelName.Test,
  Prisma.ModelName.Parameter,
  Prisma.ModelName.ReferenceRange,
  Prisma.ModelName.TestPanelItem,
  Prisma.ModelName.PriceList,
  Prisma.ModelName.PriceListItem,
  Prisma.ModelName.Counter,
  Prisma.ModelName.Patient,
  Prisma.ModelName.Doctor,
  Prisma.ModelName.Order,
  Prisma.ModelName.OrderItem,
  Prisma.ModelName.Payment,
  Prisma.ModelName.Sample,
  Prisma.ModelName.OrderTest,
  Prisma.ModelName.Result,
  Prisma.ModelName.ReportLink,
  Prisma.ModelName.ReportDelivery,
  Prisma.ModelName.Account,
  Prisma.ModelName.Invoice,
  Prisma.ModelName.AccountPayment,
  Prisma.ModelName.WalletTxn,
  Prisma.ModelName.AccountNote,
  Prisma.ModelName.LabAsset,
  Prisma.ModelName.ReportTemplate,
  Prisma.ModelName.Instrument,
  Prisma.ModelName.InstrumentMapping,
  Prisma.ModelName.InstrumentMessage,
  Prisma.ModelName.InterfaceKey,
  Prisma.ModelName.ReportDoctor,
  Prisma.ModelName.OutsourceLab,
  Prisma.ModelName.OrderTestFile,
]);

const WHERE_OPS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
]);

/**
 * A Prisma client that can only see and write one tenant's rows.
 * Route handlers use this (req.db), never the raw client, so a missing
 * `where: { tenantId }` can't leak another lab's data.
 *
 * Nested writes (e.g. `user.create({ data: { roles: { create: [...] } } })`) are not
 * rewritten: pass tenantId explicitly in nested data, or create the rows separately.
 */
export function tenantDb(tenantId: string) {
  return prisma.$extends({
    name: "tenant-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT_MODELS.has(model)) return query(args);

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const a = (args ?? {}) as any;

          if (WHERE_OPS.has(operation)) {
            a.where = { ...a.where, tenantId };
          } else if (operation === "create") {
            a.data = { ...a.data, tenantId };
          } else if (operation === "createMany" || operation === "createManyAndReturn") {
            const rows = Array.isArray(a.data) ? a.data : [a.data];
            a.data = rows.map((row: object) => ({ ...row, tenantId }));
          } else if (operation === "upsert") {
            a.where = { ...a.where, tenantId };
            a.create = { ...a.create, tenantId };
          }

          return query(a);
        },
      },
    },
  });
}

export type TenantDb = ReturnType<typeof tenantDb>;
