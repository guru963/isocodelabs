import { useState, type FormEvent } from "react";
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
      <form className="signin-card stack" onSubmit={(event) => void submit(event)}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h1>TNA Tracker</h1>
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
    </main>
  );
}
