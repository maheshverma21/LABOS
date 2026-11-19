import type { Prisma } from "@prisma/client";

type Raw = Pick<Prisma.TransactionClient, "$queryRaw">;

/**
 * Next value of a per-lab running number (1, 2, 3, ...). A single
 * INSERT ... ON CONFLICT statement, so concurrent callers never get the same
 * number. Run it inside the transaction that uses the number, so a rollback
 * gives the number back.
 */
export async function nextNumber(db: Raw, tenantId: string, key: string): Promise<number> {
  const rows = await db.$queryRaw<{ value: number }[]>`
    INSERT INTO "Counter" ("id", "tenantId", "key", "value")
    VALUES (gen_random_uuid(), ${tenantId}::uuid, ${key}, 1)
    ON CONFLICT ("tenantId", "key") DO UPDATE SET "value" = "Counter"."value" + 1
    RETURNING "value"`;
  const value = rows[0]?.value;
  if (value == null) throw new Error(`counter ${key} returned nothing`);
  return Number(value);
}
