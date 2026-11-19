import { pino } from "pino";
import { env, isProd } from "../config/env";

export const logger = pino({
  level: env.NODE_ENV === "test" && !process.env.API_LOG ? "silent" : isProd ? "info" : "debug",
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "res.headers['set-cookie']",
      "*.password",
      "*.passwordHash",
    ],
    censor: "[redacted]",
  },
  transport: isProd ? undefined : { target: "pino-pretty", options: { colorize: true } },
});
