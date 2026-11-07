import type { Prisma, PrismaClient } from "@prisma/client";
import { orderWithProgress } from "../orders/orderRisk.js";

const buyerOrderInclude = {
  ...orderWithProgress,
  milestones: {
    orderBy: { sequence: "asc" },
    include: {
      updates: {
        where: { supersededAt: null },
        orderBy: { workDate: "desc" },
        select: {
          workDate: true,
          qty: true,
          photoUrl: true,
          issue: { select: { status: true, finalCategory: true } },
        },
      },
    },
  },
} satisfies Prisma.OrderInclude;

export type BuyerOrder = Prisma.OrderGetPayload<{ include: typeof buyerOrderInclude }>;

/**
 * The only way buyer code reaches orders. A buyer id is fixed when this is created and is
 * part of every query, so a buyer cannot ask for another buyer's order, even by its exact id.
 */
export function buyerRepository(prisma: PrismaClient, buyerId: string) {
  return {
    listOrders: () =>
      prisma.order.findMany({
        where: { buyerId },
        orderBy: { exFactoryDate: "asc" },
        include: buyerOrderInclude,
      }),
    findOrder: (id: string) =>
      prisma.order.findFirst({ where: { id, buyerId }, include: buyerOrderInclude }),
    findBuyer: () => prisma.buyer.findUnique({ where: { id: buyerId } }),
    dateHistory: (order: BuyerOrder) =>
      prisma.auditLog.findMany({
        where: { entityId: { in: [order.id, ...order.milestones.map((m) => m.id)] } },
        orderBy: { at: "desc" },
        include: { user: { select: { name: true } } },
      }),
  };
}
