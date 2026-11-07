import { Router } from "express";
import { z } from "zod";
import { currentUser, requireAuth, requireRole } from "../auth/auth.middleware.js";
import type { AppDeps } from "../deps.js";
import { notFound } from "../lib/errors.js";
import { idParam, isoDate, parse } from "../lib/validate.js";
import { loadHolidays } from "./orderRisk.js";
import {
  boardFilterSchema,
  changeDateSchema,
  createOrderSchema,
  createOrdersService,
} from "./orders.service.js";
import { planMilestones } from "./tna.js";

export function ordersRoutes(deps: AppDeps): Router {
  const { prisma, jwtSecret, today } = deps;
  const service = createOrdersService(prisma, today);
  const router = Router();
  router.use(requireAuth(jwtSecret), requireRole("MERCHANDISER"));

  /** Everything the order setup form and board filters choose from. */
  router.get("/reference", async (_req, res) => {
    const [buyers, units, templates] = await Promise.all([
      prisma.buyer.findMany({ orderBy: { name: "asc" } }),
      prisma.unit.findMany({ orderBy: { name: "asc" } }),
      prisma.tnaTemplate.findMany({
        orderBy: { name: "asc" },
        include: { steps: { orderBy: { sequence: "asc" } } },
      }),
    ]);
    res.json({ buyers, units, templates });
  });

  /** Shows the milestone dates a template gives before the order is saved. */
  router.get("/templates/:id/plan", async (req, res) => {
    const { id } = parse(idParam, req.params);
    const { exFactoryDate, unitId } = parse(
      z.object({ exFactoryDate: isoDate, unitId: z.uuid() }),
      req.query,
    );
    const template = await prisma.tnaTemplate.findUnique({
      where: { id },
      include: { steps: { orderBy: { sequence: "asc" } } },
    });
    if (!template) throw notFound("Template");
    const holidays = (await loadHolidays(prisma))(unitId);
    res.json({ milestones: planMilestones(exFactoryDate, template.steps, holidays) });
  });

  router.get("/orders/board", async (req, res) => {
    res.json(await service.board(parse(boardFilterSchema, req.query)));
  });

  router.post("/orders", async (req, res) => {
    const input = parse(createOrderSchema, req.body);
    const order = await service.create(input, currentUser(req).id);
    res.status(201).json({ id: order.id });
  });

  router.get("/orders/:id", async (req, res) => {
    res.json(await service.detail(parse(idParam, req.params).id));
  });

  router.patch("/orders/:id/ex-factory", async (req, res) => {
    const { id } = parse(idParam, req.params);
    await service.changeExFactoryDate(id, parse(changeDateSchema, req.body), currentUser(req).id);
    res.json(await service.detail(id));
  });

  router.patch("/milestones/:id/date", async (req, res) => {
    const { id } = parse(idParam, req.params);
    await service.changeMilestoneDate(id, parse(changeDateSchema, req.body), currentUser(req).id);
    res.status(204).end();
  });

  router.post("/milestones/:id/complete", async (req, res) => {
    await service.completeEvent(parse(idParam, req.params).id);
    res.status(204).end();
  });

  return router;
}
