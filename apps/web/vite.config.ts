import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const API = process.env.API_ORIGIN ?? "http://localhost:4000";

// The app and API share an origin through this proxy, so the session cookie works as first-party.
const proxy = { "/api": API, "/files": API };

export default defineConfig({
  plugins: [
    react(),
    // Supervisors open the app with no signal, so the shell has to be stored on the phone.
    VitePWA({
      registerType: "autoUpdate",
      workbox: {
        globPatterns: ["**/*.{js,css,html,woff2,svg}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/files\//],
      },
      manifest: {
        name: "Nool",
        short_name: "Nool",
        description: "Daily floor numbers and order delay warnings.",
        start_url: "/",
        display: "standalone",
        background_color: "#eef0e9",
        theme_color: "#0a3a45",
        icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
      },
    }),
  ],
  server: { port: 5173, proxy },
  preview: { port: 5173, proxy },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
} as never);
