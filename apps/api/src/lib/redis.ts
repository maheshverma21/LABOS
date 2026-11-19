import { Redis } from "ioredis";
import { env } from "../config/env";
import { logger } from "./logger";

export const redis = new Redis(env.REDIS_URL, {
  // Fail fast instead of queueing commands forever when Redis is unreachable.
  maxRetriesPerRequest: 2,
  enableOfflineQueue: true,
  lazyConnect: false,
});

redis.on("error", (err) => logger.warn({ err: err.message }, "redis error"));
redis.on("ready", () => logger.info("redis connected"));
