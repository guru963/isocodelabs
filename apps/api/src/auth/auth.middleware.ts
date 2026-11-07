import type { Role } from "@prisma/client";
import type { Request, RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { AppError } from "../lib/errors.js";

export const SESSION_COOKIE = "session";

const sessionSchema = z.object({
  sub: z.string(),
  role: z.enum(["MERCHANDISER", "SUPERVISOR"]),
  unitId: z.string().nullable(),
});

export interface SessionUser {
  id: string;
  role: Role;
  unitId: string | null;
}

declare module "express-serve-static-core" {
  interface Request {
    user?: SessionUser;
    buyerId?: string;
  }
}

export function signSession(user: SessionUser, secret: string, expiresInSeconds: number): string {
  return jwt.sign({ role: user.role, unitId: user.unitId }, secret, {
    subject: user.id,
    expiresIn: expiresInSeconds,
    algorithm: "HS256",
  });
}

export function requireAuth(secret: string): RequestHandler {
  return (req, _res, next) => {
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof token !== "string") throw new AppError(401, "UNAUTHENTICATED", "Please sign in");
    try {
      const session = sessionSchema.parse(jwt.verify(token, secret, { algorithms: ["HS256"] }));
      req.user = { id: session.sub, role: session.role, unitId: session.unitId };
    } catch {
      throw new AppError(401, "UNAUTHENTICATED", "Please sign in again");
    }
    next();
  };
}

export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      throw new AppError(403, "FORBIDDEN", "You do not have access to this");
    }
    next();
  };
}

export function currentUser(req: Request): SessionUser {
  if (!req.user) throw new AppError(401, "UNAUTHENTICATED", "Please sign in");
  return req.user;
}
