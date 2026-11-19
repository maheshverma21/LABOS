import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { redis } from "../../lib/redis";
import { logger } from "../../lib/logger";

// Access tokens are stateless JWTs. To sign a device out before its token
// expires, its session id goes on a Redis deny-list for one token lifetime.
const key = (sessionId: string) => `revoked:${sessionId}`;

export async function markSessionRevoked(sessionId: string): Promise<void> {
  try {
    await redis.set(key(sessionId), "1", "EX", env.ACCESS_TOKEN_TTL);
  } catch (err) {
    // The session row is already revoked, so refresh fails; the current
    // access token stays valid until it expires (at most ACCESS_TOKEN_TTL).
    logger.warn({ err, sessionId }, "could not add session to the revocation list");
  }
}

export async function isSessionRevoked(sessionId: string): Promise<boolean> {
  try {
    return (await redis.exists(key(sessionId))) === 1;
  } catch {
    // Redis unavailable: fall back to the database.
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { revokedAt: true, expiresAt: true },
    });
    return !session || session.revokedAt !== null || session.expiresAt < new Date();
  }
}
