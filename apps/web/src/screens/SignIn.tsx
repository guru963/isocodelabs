import { useState, type FormEvent } from "react";
import { Brand } from "../components/Brand";
import { ApiError, NetworkError } from "../lib/api";
import { LanguageToggle, useLanguage } from "../lib/i18n";
import { useSession } from "../lib/session";

export default function SignIn() {
  const { signIn } = useSession();
  const { t } = useLanguage();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
    } catch (caught) {
      if (caught instanceof NetworkError) setError(t("offlineSignIn"));
      else setError(caught instanceof ApiError ? caught.message : String(caught));
      setBusy(false);
    }
  }

  return (
    <main className="signin">
      <picture>
        <source media="(max-width: 860px)" srcSet="/img/signin-hands-900.webp" />
        <img
          className="signin-photo"
          src="/img/signin-hands-1672.webp"
          alt={t("signInPhotoAlt")}
          width={1672}
          height={941}
          fetchPriority="high"
          decoding="async"
        />
      </picture>

      <div className="signin-panel">
        <div className="signin-top">
          <span className="brand">
            <Brand />
          </span>
          <span className="signin-language">
            <LanguageToggle />
          </span>
        </div>

        <div className="signin-main">
          <h1>{t("signInStory")}</h1>
          <form className="signin-card stack" onSubmit={(event) => void submit(event)}>
            <div className="field">
              <label htmlFor="email">{t("email")}</label>
              <input
                id="email"
                className="input"
                type="email"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                enterKeyHint="next"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="password">{t("password")}</label>
              <input
                id="password"
                className="input"
                type="password"
                autoComplete="current-password"
                enterKeyHint="go"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            {error && (
              <p className="signin-error" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="btn signin-submit" disabled={busy}>
              {busy ? t("signingIn") : t("signIn")}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
