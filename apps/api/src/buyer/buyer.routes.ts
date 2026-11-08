import { createHash, randomBytes } from "node:crypto";
import type { IssueCategory, PrismaClient } from "@prisma/client";
import { Router, type RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import type { AppDeps } from "../deps.js";
import { toIso } from "../lib/dates.js";
import { AppError, notFound } from "../lib/errors.js";
import { idParam, parse } from "../lib/validate.js";
import { isShipped, loadHolidays, riskOf, type HolidaysFor } from "../orders/orderRisk.js";
import { buyerRepository, type BuyerOrder } from "./buyer.repository.js";

export const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

const TOKEN_HEADER = "x-buyer-token";
const MAX_PHOTOS = 12;

const REASONS: Record<IssueCategory, string> = {
  POWER_CUT: "Power cut",
  MACHINE_BREAKDOWN: "Machine breakdown",
  WORKER_ABSENCE: "Worker absence",
  FABRIC_DELAY: "Fabric delay",
  SUBCONTRACTOR_DELAY: "Subcontractor delay",
  QUALITY_REWORK: "Quality rework",
  TRIMS_SHORTAGE: "Trims shortage",
  OTHER: "Other",
};

/** One error for a wrong, expired or revoked token, so none of them can be told apart. */
function requireBuyerLink(prisma: PrismaClient): RequestHandler {
  return async (req, _res, next) => {
    const token = req.get(TOKEN_HEADER);
    const link = token ? await prisma.buyerLink.findUnique({ where: { tokenHash: hashToken(token) } }) : null;
    if (!link || link.revokedAt || link.expiresAt <= new Date()) {
      throw new AppError(401, "INVALID_LINK", "This link is not valid. Please ask for a new one");
    }
    req.buyerId = link.buyerId;
    next();
  };
}

/**
 * The buyer's view of an order. Fields are listed one by one, so a new column can never
 * leak by accident. Internal figures, notes, units and staff stay out. A warning appears
 * only when a merchandiser has confirmed an issue on a stage that is still open.
 */
function toBuyerOrder(order: BuyerOrder, today: string, holidaysFor: HolidaysFor) {
  const risk = riskOf(order, today, holidaysFor(order.unitId));
  const confirmed = order.milestones
    .filter((milestone) => milestone.plannedQty !== null && milestone.completedAt === null)
    .flatMap((milestone) => milestone.updates)
    .flatMap((update) => (update.issue?.status === "CONFIRMED" ? [update.issue] : []));

  let progress: "SHIPPED" | "IN_PROGRESS" | "SLIGHT_DELAY" | "DELAYED" = "IN_PROGRESS";
  if (isShipped(order)) progress = "SHIPPED";
  else if (confirmed.length > 0 && risk.status === "RED") progress = "DELAYED";
  else if (confirmed.length > 0 && risk.status === "AMBER") progress = "SLIGHT_DELAY";

  const warned = progress === "DELAYED" || progress === "SLIGHT_DELAY";
  const reason = warned ? confirmed[0]?.finalCategory : null;

  const photos = order.milestones
    .flatMap((milestone) =>
      milestone.updates.flatMap((update) =>
        // A photo waits while its note is unreviewed, because it could show the problem.
        update.photoUrl && update.issue?.status !== "PENDING"
          ? [{ url: update.photoUrl, stage: milestone.stage, date: toIso(update.workDate) }]
          : [],
      ),
    )
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, MAX_PHOTOS);

  return {
    id: order.id,
    poNumber: order.poNumber,
    style: order.style,
    colour: order.colour,
    totalQty: order.totalQty,
    exFactoryDate: toIso(order.exFactoryDate),
    progress,
    reason: reason ? REASONS[reason] : null,
    milestones: order.milestones.map((milestone) => ({
      stage: milestone.stage,
      plannedDate: toIso(milestone.plannedDate),
      completedOn: milestone.completedAt && toIso(milestone.completedAt),
      percentDone:
        milestone.plannedQty === null ? null : Math.floor((milestone.doneQty / milestone.plannedQty) * 100),
    })),
    photos,
  };
}

/** Read-only endpoints for whoever holds a link. */
export function buyerRoutes(deps: AppDeps): Router {
  const { prisma, today, cache } = deps;
  const router = Router();

  // The link check above every route is never cached, so a revoked link stops working at once.
  // Every key below starts with the buyer's id, so one buyer can never receive another's answer.
  router.use(
    rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: "draft-8", legacyHeaders: false }),
    requireBuyerLink(prisma),
  );

  const repository = (buyerId: string | undefined) => {
    if (!buyerId) throw new AppError(401, "INVALID_LINK", "This link is not valid");
    return buyerRepository(prisma, buyerId);
  };

  router.get("/orders", async (req, res) => {
    const buyers = repository(req.buyerId);
    res.json(
      await cache.read(`buyer:${req.buyerId}:${today()}:orders`, async () => {
        const [buyer, orders, holidaysFor] = await Promise.all([
          buyers.findBuyer(),
          buyers.listOrders(),
          loadHolidays(prisma),
        ]);
        return {
          today: today(),
          buyer: buyer && { name: buyer.name },
          orders: orders.map((order) => toBuyerOrder(order, today(), holidaysFor)),
        };
      }),
    );
  });

  router.get("/orders/:id", async (req, res) => {
    const { id } = parse(idParam, req.params);
    const buyers = repository(req.buyerId);
    res.json(
      await cache.read(`buyer:${req.buyerId}:${today()}:order:${id}`, async () => {
        const order = await buyers.findOrder(id);
        if (!order) throw notFound("Order");

        const [holidaysFor, history] = await Promise.all([loadHolidays(prisma), buyers.dateHistory(order)]);
        const stageOf = new Map(order.milestones.map((m) => [m.id, m.stage]));
        return {
          ...toBuyerOrder(order, today(), holidaysFor),
          dateHistory: history.map((entry) => ({
            stage: stageOf.get(entry.entityId) ?? "EX_FACTORY",
            from: entry.oldValue,
            to: entry.newValue,
            reason: entry.reason,
            by: entry.user.name,
            at: entry.at.toISOString(),
          })),
        };
      }),
    );
  });

  return router;
}

const createLinkSchema = z.object({
  expiresInDays: z.number().int().min(1).max(365).default(90),
});

/** Merchandisers create and revoke links. A link's token is shown only when created. */
export function buyerLinkRoutes(deps: AppDeps): Router {
  const { prisma } = deps;
  const router = Router();
  router.use(requireAuth(deps.jwtSecret), requireRole("MERCHANDISER"));

  router.get("/buyers/:id/links", async (req, res) => {
    const { id } = parse(idParam, req.params);
    const links = await prisma.buyerLink.findMany({
      where: { buyerId: id },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true, expiresAt: true, revokedAt: true },
    });
    res.json({ links });
  });

  router.post("/buyers/:id/links", async (req, res) => {
    const { id } = parse(idParam, req.params);
    const { expiresInDays } = parse(createLinkSchema, req.body ?? {});
    const buyer = await prisma.buyer.findUnique({ where: { id } });
    if (!buyer) throw notFound("Buyer");

    const token = randomBytes(32).toString("base64url");
    const link = await prisma.buyerLink.create({
      data: {
        buyerId: id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + expiresInDays * 86_400_000),
      },
      select: { id: true, expiresAt: true },
    });
    res.status(201).json({ ...link, token });
  });

  router.post("/buyer-links/:id/revoke", async (req, res) => {
    const { id } = parse(idParam, req.params);
    const { count } = await prisma.buyerLink.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) throw notFound("Active link");
    res.status(204).end();
  });

  return router;
}
