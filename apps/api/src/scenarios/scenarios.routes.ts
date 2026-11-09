import { Router } from "express";
import { currentUser, requireAuth, requireRole } from "../auth/auth.middleware.js";
import type { AppDeps } from "../deps.js";
import { runScenarios } from "./scenarios.js";

/** The Scenario lab: runs every edge case through the real code and reports what happened. */
export function scenariosRoutes(deps: AppDeps): Router {
  const router = Router();
  router.post("/scenarios/run", requireAuth(deps.jwtSecret), requireRole("MERCHANDISER"), async (req, res) => {
    const started = Date.now();
    const results = await runScenarios(deps.prisma, deps.today, currentUser(req).id);
    res.json({ results, ms: Date.now() - started, ranAt: new Date().toISOString() });
  });
  return router;
}
