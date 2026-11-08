import { Router } from "express";
import { currentUser, requireAuth } from "../auth/auth.middleware.js";
import type { AppDeps } from "../deps.js";
import { notFound } from "../lib/errors.js";
import { idParam, parse } from "../lib/validate.js";

/** Each person reads only their own notifications. Never cached, so a new one shows at once. */
export function notificationsRoutes(deps: AppDeps): Router {
  const { prisma } = deps;
  const router = Router();
  router.use("/notifications", requireAuth(deps.jwtSecret));

  router.get("/notifications", async (req, res) => {
    const userId = currentUser(req).id;
    const [items, unread] = await Promise.all([
      prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 30,
        include: { messages: { select: { channel: true } } },
      }),
      prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    res.json({
      unread,
      notifications: items.map((item) => ({
        id: item.id,
        kind: item.kind,
        title: item.title,
        body: item.body,
        link: item.link,
        createdAt: item.createdAt.toISOString(),
        read: item.readAt !== null,
        channels: [...new Set(item.messages.map((message) => message.channel))],
      })),
    });
  });

  router.post("/notifications/read-all", async (req, res) => {
    await prisma.notification.updateMany({
      where: { userId: currentUser(req).id, readAt: null },
      data: { readAt: new Date() },
    });
    res.status(204).end();
  });

  router.post("/notifications/:id/read", async (req, res) => {
    const { id } = parse(idParam, req.params);
    // The user id is part of the match, so nobody can mark someone else's notification.
    const { count } = await prisma.notification.updateMany({
      where: { id, userId: currentUser(req).id },
      data: { readAt: new Date() },
    });
    if (count === 0) throw notFound("Notification");
    res.status(204).end();
  });

  return router;
}
