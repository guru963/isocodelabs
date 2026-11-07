import { randomBytes, randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { hashToken } from "../buyer/buyer.routes.js";
import { fromIso } from "../lib/dates.js";
import { planMilestones } from "../orders/tna.js";
import {
  BUYERS,
  isQuantityStage,
  LINK_EXPIRY,
  MERCHANDISER,
  NO_HOLIDAYS,
  SAMPLE_ORDERS,
  SUPERVISORS,
  TEMPLATES,
  UNITS,
  type SeedStage,
} from "./sampleData.js";

async function clearAll(prisma: PrismaClient) {
  await prisma.auditLog.deleteMany();
  await prisma.holiday.deleteMany();
  await prisma.buyerLink.deleteMany();
  await prisma.order.deleteMany();
  await prisma.tnaTemplate.deleteMany();
  await prisma.buyer.deleteMany();
  await prisma.user.deleteMany();
  await prisma.unit.deleteMany();
}

/** Replaces all data, so seeding always gives the same demo. Returns each buyer's link token. */
export async function seedDatabase(prisma: PrismaClient, password: string): Promise<Record<string, string>> {
  await clearAll(prisma);

  const passwordHash = await bcrypt.hash(password, 10);

  const unitIds = new Map<string, string>();
  for (const unit of UNITS) {
    unitIds.set(unit.name, (await prisma.unit.create({ data: unit })).id);
  }
  const unitId = (name: string) => unitIds.get(name)!;

  const merchandiser = await prisma.user.create({
    data: { ...MERCHANDISER, passwordHash, role: "MERCHANDISER", language: "en" },
  });

  const supervisorIds = new Map<string, string>();
  for (const { unit, ...supervisor } of SUPERVISORS) {
    const created = await prisma.user.create({
      data: { ...supervisor, passwordHash, role: "SUPERVISOR", language: "ta", unitId: unitId(unit) },
    });
    supervisorIds.set(unit, created.id);
  }

  const buyerIds = new Map<string, string>();
  for (const buyer of BUYERS) {
    buyerIds.set(buyer.name, (await prisma.buyer.create({ data: buyer })).id);
  }

  const templateIds = new Map<string, string>();
  for (const [name, steps] of Object.entries(TEMPLATES)) {
    const template = await prisma.tnaTemplate.create({
      data: {
        name,
        steps: { create: steps.map((step, index) => ({ ...step, sequence: index + 1 })) },
      },
    });
    templateIds.set(name, template.id);
  }

  for (const order of SAMPLE_ORDERS) {
    const created = await prisma.order.create({
      data: {
        poNumber: order.poNumber,
        buyerId: buyerIds.get(order.buyer)!,
        style: order.style,
        colour: order.colour,
        totalQty: order.totalQty,
        exFactoryDate: fromIso(order.exFactoryDate),
        unitId: unitId(order.unit),
        merchandiserId: merchandiser.id,
        templateId: templateIds.get(order.template)!,
        sizes: { create: Object.entries(order.sizes).map(([size, qty]) => ({ size, qty })) },
      },
    });

    const plan = planMilestones<SeedStage>(order.exFactoryDate, TEMPLATES[order.template], NO_HOLIDAYS);
    for (const milestone of plan) {
      const outputs = order.outputs[milestone.stage] ?? [];
      const doneQty = outputs.reduce((sum, output) => sum + output.qty, 0);
      const stageUnit = order.stageUnits?.[milestone.stage] ?? order.unit;
      const finished = isQuantityStage(milestone.stage) && doneQty === order.totalQty;

      const { id: milestoneId } = await prisma.milestone.create({
        data: {
          orderId: created.id,
          stage: milestone.stage,
          sequence: milestone.sequence,
          plannedDate: fromIso(milestone.plannedDate),
          unitId: unitId(stageUnit),
          plannedQty: isQuantityStage(milestone.stage) ? order.totalQty : null,
          doneQty,
          completedAt: finished ? fromIso(outputs[outputs.length - 1]!.date) : null,
        },
      });

      for (const output of outputs) {
        const note = order.notes.find(
          (candidate) => candidate.stage === milestone.stage && candidate.date === output.date,
        );
        await prisma.dailyUpdate.create({
          data: {
            id: randomUUID(),
            milestoneId,
            supervisorId: supervisorIds.get(stageUnit)!,
            workDate: fromIso(output.date),
            qty: output.qty,
            noteText: note?.original,
            capturedAt: new Date(`${output.date}T12:30:00Z`), // 6 pm in India
            issue: note && {
              create: {
                originalText: note.original,
                translatedText: note.translated,
                aiStatus: "COMPLETED",
                aiAttempts: 1,
                aiCategory: note.category,
                aiConfidence: note.confidence,
              },
            },
          },
        });
      }
    }
  }

  const finishing = await prisma.milestone.findFirstOrThrow({
    where: { stage: "FINISHING", order: { poNumber: "B-PO-88240" } },
  });
  await prisma.auditLog.create({
    data: {
      entity: "Milestone",
      entityId: finishing.id,
      field: "plannedDate",
      oldValue: "2026-11-09",
      newValue: "2026-11-10",
      reason: "Stitching finished a day later than planned",
      userId: merchandiser.id,
    },
  });

  const tokens: Record<string, string> = {};
  for (const buyer of BUYERS) {
    const token = randomBytes(32).toString("base64url");
    await prisma.buyerLink.create({
      data: {
        buyerId: buyerIds.get(buyer.name)!,
        tokenHash: hashToken(token),
        expiresAt: fromIso(LINK_EXPIRY),
      },
    });
    tokens[buyer.name] = token;
  }
  return tokens;
}
