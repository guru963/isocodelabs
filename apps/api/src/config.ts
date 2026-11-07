import { z } from "zod";

const emptyToUndefined = (value: unknown) => (value === "" ? undefined : value);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  UPLOAD_DIR: z.string().min(1).default("./uploads"),
  APP_TODAY: z.preprocess(emptyToUndefined, z.iso.date().optional()),
  GROQ_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  AI_MODEL: z.string().min(1).default("openai/gpt-oss-120b"),
});

export type Config = z.infer<typeof envSchema>;

/** Stops the server at startup, rather than at first use, if a setting is wrong. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
