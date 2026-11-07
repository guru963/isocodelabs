import { useState, type FormEvent } from "react";
import { Seam } from "../components/Seam";
import { BrandMark } from "../components/Shell";
import { ApiError, NetworkError } from "../lib/api";
import { LanguageToggle, useLanguage } from "../lib/i18n";
import { useSession } from "../lib/session";

export default function SignIn() {
  const { signIn } = useSession();
  const { t, stage } = useLanguage();
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
      <section className="signin-story on-dark">
        <span className="brand">
          <BrandMark />
          TNA Tracker
        </span>
        <h1>{t("signInStory")}</h1>
        <div className="signin-sample" aria-hidden="true">
          <Seam
            stages={(
              [
                ["CUTTING", null, true],
                ["STITCHING", null, true],
                ["FINISHING", 65, false],
                ["INSPECTION", null, false],
                ["EX_FACTORY", null, false],
              ] as const
            ).map(([key, percent, done]) => ({
              key,
              label: stage(key),
              date: "",
              caption: "",
              percent,
              done,
            }))}
          />
          <p className="small">{t("signInExample")}</p>
        </div>
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
      </section>
    </main>
  );
}
