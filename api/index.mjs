// The whole API as one Vercel Function. `npm run build:vercel` bundles apps/api/src/vercel.ts
// into this import; vercel.json sends /api/* and /files/* here.
export { default } from "../apps/api/dist/vercel.mjs";
