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
    const user = currentUser(req);
    const key = `worklist:${deps.today()}:${user.id}:${user.unitId}`;
    res.json(await deps.cache.read(key, () => service.worklist(user)));
  });

  router.post("/updates/sync", async (req, res) => {
    const { updates } = parse(syncBodySchema, req.body);
    const results = await service.sync(updates, currentUser(req));
    await deps.cache.invalidate();
    res.json({ results });
  });

  return router;
}
