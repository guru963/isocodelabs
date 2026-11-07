import "@fontsource-variable/noto-sans-tamil/wght.css";
import "./styles/app.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { LanguageProvider } from "./lib/i18n";
import { SessionProvider } from "./lib/session";

registerSW({ immediate: true });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LanguageProvider>
      <SessionProvider>
        <App />
      </SessionProvider>
    </LanguageProvider>
  </StrictMode>,
);
