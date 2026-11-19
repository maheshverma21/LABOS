import { redis } from "./redis";
import { logger } from "./logger";
import { tooManyRequests } from "./errors";

/**
 * Fixed-window counter in Redis. Throws 429 once `limit` hits are reached
 * within `windowSeconds`. If Redis is down it lets the request through.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<void> {
  let count: number;
  try {
    const k = `rl:${key}`;
    count = await redis.incr(k);
    if (count === 1) await redis.expire(k, windowSeconds);
  } catch (err) {
    logger.warn({ err, key }, "rate limiter unavailable; allowing request");
    return;
  }
  if (count > limit) throw tooManyRequests();
}

export async function resetRateLimit(key: string): Promise<void> {
  await redis.del(`rl:${key}`).catch(() => undefined);
}
