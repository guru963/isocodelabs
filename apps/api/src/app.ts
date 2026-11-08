import cookieParser from "cookie-parser";
import express, { type ErrorRequestHandler, type Express } from "express";
import helmet from "helmet";
import multer from "multer";
import { authRoutes } from "./auth/auth.routes.js";
import { buyerLinkRoutes, buyerRoutes } from "./buyer/buyer.routes.js";
import type { AppDeps } from "./deps.js";
import { issuesRoutes } from "./issues/issues.routes.js";
import { notificationsRoutes } from "./notifications/notifications.routes.js";
import { AppError } from "./lib/errors.js";
import { ordersRoutes } from "./orders/orders.routes.js";
import { updatesRoutes } from "./updates/updates.routes.js";
import { uploadsRoutes } from "./uploads/uploads.routes.js";

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof AppError) {
    res.status(error.status).json({ error: { code: error.code, message: error.message, details: error.details } });
    return;
  }
  if (error instanceof multer.MulterError) {
    const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    res.status(status).json({ error: { code: error.code, message: error.message } });
    return;
  }
  const bodyError = error as { type?: string };
  if (bodyError.type === "entity.parse.failed") {
    res.status(400).json({ error: { code: "BAD_JSON", message: "The request body is not valid JSON" } });
    return;
  }
  if (bodyError.type === "entity.too.large") {
    res.status(413).json({ error: { code: "TOO_LARGE", message: "The request is too large" } });
    return;
  }
  // Unexpected errors are logged in full, but the client never sees their details.
  console.error(error);
  res.status(500).json({ error: { code: "INTERNAL", message: "Something went wrong" } });
};

export function createApp(deps: AppDeps, uploadDir: string): Express {
  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(helmet({ referrerPolicy: { policy: "no-referrer" } }));
  app.use(express.json({ limit: "256kb" }));
  app.use(cookieParser());

  app.get("/api/health", async (_req, res) => {
    await deps.prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok" });
  });

  app.use("/files", express.static(uploadDir, { index: false, dotfiles: "ignore", maxAge: "7d" }));

  app.use("/api/auth", authRoutes(deps));
  app.use("/api/buyer", buyerRoutes(deps));
  // Before the merchandiser-only routers below: they refuse every other /api request from a supervisor.
  app.use("/api", notificationsRoutes(deps));
  app.use("/api/supervisor", updatesRoutes(deps));
  app.use("/api/supervisor", uploadsRoutes(deps));
  app.use("/api", ordersRoutes(deps));
  app.use("/api", issuesRoutes(deps));
  app.use("/api", buyerLinkRoutes(deps));

  app.use("/api", (_req, _res, next) => {
    next(new AppError(404, "NOT_FOUND", "No such endpoint"));
  });
  app.use(errorHandler);
  return app;
}
