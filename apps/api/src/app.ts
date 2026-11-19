import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { pinoHttp } from "pino-http";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import { prisma } from "./lib/prisma";
import { redis } from "./lib/redis";
import { authRouter } from "./modules/auth/auth.routes";
import { usersRouter } from "./modules/users/users.routes";
import { catalogRouter } from "./modules/catalog/catalog.routes";
import { doctorsRouter, patientsRouter } from "./modules/patients/patients.routes";
import { billingRouter, ordersRouter } from "./modules/orders/orders.routes";
import { labRouter } from "./modules/lab/lab.routes";
import { samplesRouter } from "./modules/samples/samples.routes";
import { resultsRouter } from "./modules/results/results.routes";
import { publicReportsRouter, reportsRouter } from "./modules/reports/reports.routes";
import { adminRouter } from "./modules/admin/admin.routes";
import { accountsRouter, invoicesRouter } from "./modules/accounts/accounts.routes";
import { portalRouter } from "./modules/accounts/portal.routes";
import { outsourcingRouter } from "./modules/outsourcing/outsourcing.routes";
import { brandingRouter, profileRouter, userAssetsRouter } from "./modules/branding/branding.routes";
import { instrumentsRouter, interfaceRouter } from "./modules/instruments/instruments.routes";
import { errorHandler, notFoundHandler } from "./middleware/error-handler";

export function createApp() {
  const app = express();

  // Behind proxies (Next.js rewrites locally; Caddy + Next.js in deploy/), so req.ip is the client's address.
  app.set("trust proxy", env.TRUST_PROXY);
  app.disable("x-powered-by");

  app.use(helmet());
  app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }));
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === "/api/health" },
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info"),
    }),
  );

  app.get("/api/health", async (_req, res) => {
    const [db, cache] = await Promise.allSettled([prisma.$queryRaw`SELECT 1`, redis.ping()]);
    const ok = db.status === "fulfilled" && cache.status === "fulfilled";
    res.status(ok ? 200 : 503).json({
      status: ok ? "ok" : "degraded",
      database: db.status === "fulfilled" ? "up" : "down",
      redis: cache.status === "fulfilled" ? "up" : "down",
    });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/users", userAssetsRouter);
  app.use("/api/profile", profileRouter);
  app.use("/api/catalog", catalogRouter);
  app.use("/api/patients", patientsRouter);
  app.use("/api/doctors", doctorsRouter);
  app.use("/api/orders", ordersRouter);
  app.use("/api/billing", billingRouter);
  app.use("/api/lab", labRouter);
  app.use("/api/lab", brandingRouter);
  app.use("/api/outsourcing", outsourcingRouter);
  app.use("/api/samples", samplesRouter);
  app.use("/api/results", resultsRouter);
  app.use("/api/reports", reportsRouter);
  app.use("/api/accounts", accountsRouter);
  app.use("/api/invoices", invoicesRouter);
  app.use("/api/b2b", portalRouter);
  app.use("/api/public/reports", publicReportsRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/instruments", instrumentsRouter);
  app.use("/api/interface", interfaceRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
