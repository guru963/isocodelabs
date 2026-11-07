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
      <section className="signin-story">
        <picture>
          <source media="(max-width: 860px)" srcSet="/img/signin-stitching-800.webp" />
          <img
            className="signin-photo"
            src="/img/signin-stitching-1600.webp"
            alt={t("signInPhotoAlt")}
            width={1600}
            height={1067}
            fetchPriority="high"
            decoding="async"
          />
        </picture>
        <span className="brand signin-brand">
          <Brand />
        </span>
        <h1>{t("signInStory")}</h1>
      </section>
      <section className="signin-form">
        <form className="signin-card stack" onSubmit={(event) => void submit(event)}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2>{t("signIn")}</h2>
            <span className="small">
              <LanguageToggle />
            </span>
          </div>
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
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? t("signingIn") : t("signIn")}
          </button>
        </form>
        <p className="signin-credit">
          Photo by{" "}
          <a href="https://unsplash.com/photos/a-woman-sews-at-a-textile-factory-efqWDl6kW1M" target="_blank" rel="noreferrer">
            EqualStock on Unsplash
          </a>
        </p>
      </section>
    </main>
  );
}
