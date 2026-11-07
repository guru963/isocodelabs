import { Router } from "express";
import { z } from "zod";
import { CATEGORIES, needsReview } from "../ai/classification.js";
import { currentUser, requireAuth, requireRole } from "../auth/auth.middleware.js";
import type { AppDeps } from "../deps.js";
import { toIso } from "../lib/dates.js";
import { AppError, notFound } from "../lib/errors.js";
import { idParam, parse } from "../lib/validate.js";

const listSchema = z.object({
  status: z.enum(["PENDING", "CONFIRMED", "DISMISSED"]).default("PENDING"),
});

const reviewSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("CONFIRM"),
    /** Leave out to accept the AI's category. */
    category: z.enum(CATEGORIES).optional(),
    /** Lets a person correct the English, or type it for a voice note. */
    translatedText: z.string().trim().min(1).max(1000).optional(),
  }),
  z.object({ action: z.literal("DISMISS") }),
]);

export function issuesRoutes(deps: AppDeps): Router {
  const { prisma, cache } = deps;
  const router = Router();
  router.use(requireAuth(deps.jwtSecret), requireRole("MERCHANDISER"));

  router.get("/issues", async (req, res) => {
    const { status } = parse(listSchema, req.query);
    res.json(
      await cache.read(`issues:${status}`, async () => {
        const issues = await prisma.issue.findMany({
          where: { status },
          orderBy: { createdAt: "desc" },
          take: 100,
          include: {
            dailyUpdate: {
              select: {
                workDate: true,
                voiceUrl: true,
                photoUrl: true,
                supervisor: { select: { name: true } },
                milestone: {
                  select: {
                    stage: true,
                    order: {
                      select: {
                        id: true,
                        poNumber: true,
                        style: true,
                        colour: true,
                        buyer: { select: { name: true } },
                      },
                    },
                  },
                },
              },
            },
          },
        });
        return {
          issues: issues.map((issue) => ({
            id: issue.id,
            status: issue.status,
            originalText: issue.originalText,
            translatedText: issue.translatedText,
            aiStatus: issue.aiStatus,
            aiError: issue.aiError,
            aiCategory: issue.aiCategory,
            aiConfidence: issue.aiConfidence,
            finalCategory: issue.finalCategory,
            needsReview: needsReview(issue),
            stage: issue.dailyUpdate.milestone.stage,
            order: issue.dailyUpdate.milestone.order,
            workDate: toIso(issue.dailyUpdate.workDate),
            supervisor: issue.dailyUpdate.supervisor.name,
            voiceUrl: issue.dailyUpdate.voiceUrl,
            photoUrl: issue.dailyUpdate.photoUrl,
          })),
        };
      }),
    );
  });

  /** How often people kept the AI's category, from every reviewed note. */
  router.get("/issues/accuracy", async (_req, res) => {
    res.json(
      await cache.read("issues:accuracy", async () => {
        const reviewed = await prisma.issue.findMany({
          where: { status: "CONFIRMED", aiCategory: { not: null } },
          select: { aiCategory: true, finalCategory: true },
        });
        const agreed = reviewed.filter((issue) => issue.aiCategory === issue.finalCategory).length;
        return { reviewed: reviewed.length, agreed };
      }),
    );
  });

  router.post("/issues/:id/review", async (req, res) => {
    const { id } = parse(idParam, req.params);
    const input = parse(reviewSchema, req.body);
    const issue = await prisma.issue.findUnique({ where: { id } });
    if (!issue) throw notFound("Issue");

    const reviewed = { reviewedById: currentUser(req).id, reviewedAt: new Date() };

    if (input.action === "DISMISS") {
      await prisma.issue.update({ where: { id }, data: { status: "DISMISSED", ...reviewed } });
    } else {
      const finalCategory = input.category ?? issue.aiCategory;
      if (!finalCategory) {
        throw new AppError(400, "CATEGORY_REQUIRED", "The AI gave no category, so please choose one");
      }
      await prisma.issue.update({
        where: { id },
        data: {
          status: "CONFIRMED",
          finalCategory,
          translatedText: input.translatedText ?? issue.translatedText,
          ...reviewed,
        },
      });
    }
    await cache.invalidate();
    res.status(204).end();
  });

  /** Sends a failed note back through the AI, such as after an outage. */
  router.post("/issues/:id/retry", async (req, res) => {
    const { id } = parse(idParam, req.params);
    const issue = await prisma.issue.findUnique({ where: { id } });
    if (!issue) throw notFound("Issue");
    if (issue.aiStatus !== "FAILED") throw new AppError(409, "NOT_FAILED", "Only a failed note can be retried");
    if (!issue.originalText) throw new AppError(409, "NO_TEXT", "A voice note has no text for the AI to read");

    await prisma.issue.update({ where: { id }, data: { aiStatus: "PENDING", aiAttempts: 0, aiError: null } });
    await cache.invalidate();
    deps.aiQueue.schedule(id);
    res.status(202).end();
  });

  return router;
}
