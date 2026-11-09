import { Router } from "express";
import { z } from "zod";
import { currentUser, requireAuth, requireRole } from "../auth/auth.middleware.js";
import type { AppDeps } from "../deps.js";
import { draftBuyerMessage, type BuyerMessageFacts } from "../ai/buyerMessage.js";
import { REASONS } from "../buyer/buyer.routes.js";
import { AppError, notFound } from "../lib/errors.js";
import { idParam, isoDate, parse } from "../lib/validate.js";
import { loadHolidays } from "./orderRisk.js";
import {
  boardFilterSchema,
  changeDateSchema,
  createOrderSchema,
  createOrdersService,
} from "./orders.service.js";
import { earliestExFactory, planMilestones } from "./tna.js";

export function ordersRoutes(deps: AppDeps): Router {
  const { prisma, jwtSecret, today, cache } = deps;
  const service = createOrdersService(prisma, today);
  const router = Router();
  router.use(requireAuth(jwtSecret), requireRole("MERCHANDISER"));

  /** Everything the order setup form and board filters choose from. */
  router.get("/reference", async (_req, res) => {
    res.json(
      await cache.read("reference", async () => {
        const [buyers, units, templates] = await Promise.all([
          prisma.buyer.findMany({ orderBy: { name: "asc" } }),
          prisma.unit.findMany({ orderBy: { name: "asc" } }),
          prisma.tnaTemplate.findMany({
            orderBy: { name: "asc" },
            include: { steps: { orderBy: { sequence: "asc" } } },
          }),
        ]);
        return { buyers, units, templates };
      }),
    );
  });

  /** Shows the milestone dates a template gives before the order is saved. */
  /**
   * The plan for a template, worked back from an ex-factory date, and the earliest ex-factory
   * date that still gives the template its full lead time. Without a date, only the earliest.
   */
  router.get("/templates/:id/plan", async (req, res) => {
    const { id } = parse(idParam, req.params);
    const { exFactoryDate, unitId } = parse(
      z.object({ exFactoryDate: isoDate.optional(), unitId: z.uuid() }),
      req.query,
    );
    const template = await prisma.tnaTemplate.findUnique({
      where: { id },
      include: { steps: { orderBy: { sequence: "asc" } } },
    });
    if (!template) throw notFound("Template");
    const holidays = (await loadHolidays(prisma))(unitId);
    const now = today();
    res.json({
      today: now,
      earliestExFactory: earliestExFactory(now, template.steps, holidays),
      milestones: exFactoryDate ? planMilestones(exFactoryDate, template.steps, holidays) : null,
    });
  });

  router.get("/orders/board", async (req, res) => {
    const filter = parse(boardFilterSchema, req.query);
    // Today is in the key because risk changes with the date, even when no data does.
    res.json(await cache.read(`board:${today()}:${JSON.stringify(filter)}`, () => service.board(filter)));
  });

  router.post("/orders", async (req, res) => {
    const input = parse(createOrderSchema, req.body);
    const order = await service.create(input, currentUser(req).id);
    await cache.invalidate();
    res.status(201).json({ id: order.id });
  });

  router.get("/orders/:id", async (req, res) => {
    const { id } = parse(idParam, req.params);
    res.json(await cache.read(`order:${today()}:${id}`, () => service.detail(id)));
  });

  /**
   * A draft message asking the buyer to agree a new ex-factory date, for a stage that no plan can
   * recover. Every figure in it comes from the catch-up planner; the AI only words it, and a draft
   * that states anything else is replaced by a template. Nothing is sent from here.
   */
  router.post("/orders/:id/buyer-message", async (req, res) => {
    const { id } = parse(idParam, req.params);
    const { stage } = parse(z.object({ stage: z.string().min(1) }), req.body ?? {});
    const order = await service.detail(id);
    const milestone = order.milestones.find((m) => m.stage === stage);
    const lastResort = milestone?.catchUp?.lastResort;
    if (!lastResort?.newExFactory || !lastResort.exFactoryDate) {
      throw new AppError(409, "NO_NEW_DATE", "This stage can still be recovered, so there is no new date to ask the buyer for");
    }

    const longDate = (iso: string) =>
      new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
    const dayName = (iso: string) =>
      new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
    const stageName = stage.charAt(0) + stage.slice(1).toLowerCase().replace("_", "-");
    const { combined } = lastResort;
    // The latest confirmed reason, if a merchandiser has confirmed one; "other" tells the buyer nothing.
    const confirmed = order.issues.find((issue) => issue.status === "CONFIRMED" && issue.finalCategory && issue.finalCategory !== "OTHER");

    const facts: BuyerMessageFacts = {
      buyerName: order.buyer.name,
      poNumber: order.poNumber,
      style: order.style,
      colour: order.colour,
      stage: stageName,
      agreedExFactory: longDate(lastResort.exFactoryDate),
      newExFactory: longDate(lastResort.newExFactory),
      reason: confirmed?.finalCategory ? REASONS[confirmed.finalCategory] : null,
      actions: [
        `raising ${stageName.toLowerCase()} to ${combined.perDay.toLocaleString("en-GB")} pieces a day, ${combined.increasePercent}% above its current pace`,
        ...(combined.dates.length > 0 ? [`working ${combined.dates.map(dayName).join(" and ")}`] : []),
      ],
      merchandiserName: order.merchandiser,
    };
    res.json(await draftBuyerMessage(deps.messageWriter ?? null, facts));
  });

  router.patch("/orders/:id/ex-factory", async (req, res) => {
    const { id } = parse(idParam, req.params);
    await service.changeExFactoryDate(id, parse(changeDateSchema, req.body), currentUser(req).id);
    await cache.invalidate();
    res.json(await service.detail(id));
  });

  router.patch("/milestones/:id/date", async (req, res) => {
    const { id } = parse(idParam, req.params);
    await service.changeMilestoneDate(id, parse(changeDateSchema, req.body), currentUser(req).id);
    await cache.invalidate();
    res.status(204).end();
  });

  router.post("/milestones/:id/complete", async (req, res) => {
    await service.completeEvent(parse(idParam, req.params).id);
    await cache.invalidate();
    res.status(204).end();
  });

  return router;
}
