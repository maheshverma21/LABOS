import type { Request } from "express";
import { badRequest, forbidden } from "../lib/errors";
import { ctx } from "./auth";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The branch the user is working at, from the X-Branch-Id header the web app
 * sends. Checked against the user's branch access. Without the header, a
 * single-branch user gets their branch and everyone else gets null.
 */
export async function resolveBranchId(req: Request): Promise<string | null> {
  const { auth, db } = ctx(req);
  const header = req.get("x-branch-id");

  if (!header) return auth.branchIds?.length === 1 ? auth.branchIds[0]! : null;

  if (!UUID.test(header)) throw badRequest("Invalid branch");
  if (auth.branchIds && !auth.branchIds.includes(header)) throw forbidden("You don't have access to this branch");
  const branch = await db.branch.findFirst({ where: { id: header, isActive: true }, select: { id: true } });
  if (!branch) throw badRequest("Unknown branch");
  return branch.id;
}
