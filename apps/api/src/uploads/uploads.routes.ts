import { Router } from "express";
import multer from "multer";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import type { AppDeps } from "../deps.js";
import { AppError } from "../lib/errors.js";
import { detectFileKind } from "./storage.js";

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export function uploadsRoutes(deps: AppDeps): Router {
  const router = Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });

  router.post(
    "/uploads",
    requireAuth(deps.jwtSecret),
    requireRole("SUPERVISOR"),
    upload.single("file"),
    async (req, res) => {
      if (!req.file) throw new AppError(400, "NO_FILE", "Attach a file in the 'file' field");
      const extension = detectFileKind(req.file.buffer);
      if (!extension) throw new AppError(415, "UNSUPPORTED_FILE", "Only photos and voice notes can be uploaded");
      res.status(201).json({ url: await deps.storage.save(req.file.buffer, extension) });
    },
  );

  return router;
}
