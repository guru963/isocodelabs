import { Router } from "express";
import { currentUser, requireAuth, requireRole } from "../auth/auth.middleware.js";
import type { AppDeps } from "../deps.js";
import { parse } from "../lib/validate.js";
import { createUpdatesService, syncBodySchema } from "./updates.service.js";

export function updatesRoutes(deps: AppDeps): Router {
  const service = createUpdatesService(deps.prisma, deps.today, deps.aiQueue);
  const router = Router();
  router.use(requireAuth(deps.jwtSecret), requireRole("SUPERVISOR"));

  router.get("/worklist", async (req, res) => {
    res.json(await service.worklist(currentUser(req)));
  });

  router.post("/updates/sync", async (req, res) => {
    const { updates } = parse(syncBodySchema, req.body);
    res.json({ results: await service.sync(updates, currentUser(req)) });
  });

  return router;
}
