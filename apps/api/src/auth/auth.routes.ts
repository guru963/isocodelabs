import bcrypt from "bcryptjs";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { AppError } from "../lib/errors.js";
import { parse } from "../lib/validate.js";
import { currentUser, requireAuth, SESSION_COOKIE, signSession } from "./auth.middleware.js";

const HOUR = 3600;
/** A supervisor's queued updates must still sync after days of bad network. */
const SESSION_SECONDS = { MERCHANDISER: 12 * HOUR, SUPERVISOR: 30 * 24 * HOUR } as const;

/** Compared when the email is unknown, so response time does not reveal which emails exist. */
const UNKNOWN_USER_HASH = bcrypt.hashSync("no-user-has-this-password", 10);

const loginSchema = z.object({
  email: z.email().toLowerCase(),
  password: z.string().min(1).max(200),
});

export function authRoutes(deps: AppDeps): Router {
  const router = Router();
  const { prisma, jwtSecret, secureCookies } = deps;

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: deps.loginAttemptsPerWindow ?? 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, _res, next) => {
      next(new AppError(429, "TOO_MANY_ATTEMPTS", "Too many attempts. Try again in a few minutes"));
    },
  });

  router.post("/login", loginLimiter, async (req, res) => {
    const { email, password } = parse(loginSchema, req.body);
    const user = await prisma.user.findUnique({ where: { email } });
    const matches = await bcrypt.compare(password, user?.passwordHash ?? UNKNOWN_USER_HASH);
    if (!user || !matches) throw new AppError(401, "BAD_CREDENTIALS", "Wrong email or password");

    const seconds = SESSION_SECONDS[user.role];
    const session = { id: user.id, role: user.role, unitId: user.unitId };
    res.cookie(SESSION_COOKIE, signSession(session, jwtSecret, seconds), {
      httpOnly: true,
      sameSite: "lax",
      secure: secureCookies,
      maxAge: seconds * 1000,
    });
    res.json({
      user: { id: user.id, name: user.name, role: user.role, unitId: user.unitId, language: user.language },
    });
  });

  router.post("/logout", (_req, res) => {
    res.clearCookie(SESSION_COOKIE);
    res.status(204).end();
  });

  router.get("/me", requireAuth(jwtSecret), async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: currentUser(req).id } });
    if (!user) throw new AppError(401, "UNAUTHENTICATED", "Please sign in again");
    res.json({
      user: { id: user.id, name: user.name, role: user.role, unitId: user.unitId, language: user.language },
      today: deps.today(),
    });
  });

  return router;
}
