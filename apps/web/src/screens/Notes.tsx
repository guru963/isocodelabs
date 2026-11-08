import { useEffect, useState } from "react";
import { Select } from "../components/Picker";
import { Link, useOutletContext, useSearchParams } from "react-router-dom";
import type { ShellContext } from "../components/Shell";
import { LoadError, SkeletonRows } from "../components/States";
import { api, errorMessage } from "../lib/api";
import { CATEGORIES, CATEGORY_LABEL, shortDate, STAGE_LABEL } from "../lib/format";
import type { Issue, IssueCategory, IssueStatus } from "../lib/types";
import { useLoad } from "../lib/useLoad";
import { notify } from "../lib/toast";

const TABS: { status: IssueStatus; label: string }[] = [
  { status: "PENDING", label: "Waiting" },
  { status: "CONFIRMED", label: "Confirmed" },
  { status: "DISMISSED", label: "Dismissed" },
];

const AI_POLL_MS = 5000;

function AiLine({ issue }: { issue: Issue }) {
  if (issue.aiStatus === "PENDING") return <p className="small muted">The AI is still reading this note.</p>;
  if (issue.aiStatus === "FAILED") {
    return (
      <p className="small note-pending">
        {issue.originalText
          ? "The AI could not read this note. Please choose a category."
          : "A voice note has no text for the AI. Listen, then choose a category."}
      </p>
    );
  }
  if (!issue.aiCategory) return null;
  const percent = issue.aiConfidence === null ? null : Math.round(issue.aiConfidence * 100);
  return (
    <p className={issue.needsReview ? "small note-pending" : "small muted"}>
      AI suggests {CATEGORY_LABEL[issue.aiCategory]}
      {percent !== null && `, ${percent}% sure`}
      {issue.needsReview && ". Please check this one"}
    </p>
  );
}

function IssueCard({ issue, onChanged }: { issue: Issue; onChanged(): Promise<void> }) {
  const [category, setCategory] = useState<IssueCategory | "">(issue.finalCategory ?? issue.aiCategory ?? "");
  const [translation, setTranslation] = useState(issue.translatedText ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reviewable = issue.status === "PENDING";

  // The AI can finish while this card is on screen. Its answer fills in only what is still blank.
  useEffect(() => {
    if (issue.aiCategory) setCategory((current) => current || issue.aiCategory || "");
    if (issue.translatedText) setTranslation((current) => current || issue.translatedText || "");
  }, [issue.aiCategory, issue.translatedText]);

  async function run(action: () => Promise<unknown>, done?: { title: string; description?: string }) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await onChanged();
      if (done) notify.success(done.title, done.description);
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  }

  function confirm() {
    if (!category) {
      setError("Choose a category first.");
      return;
    }
    const edited = translation.trim();
    void run(() =>
      api(`/issues/${issue.id}/review`, {
        method: "POST",
        body: {
          action: "CONFIRM",
          category,
          ...(edited && edited !== issue.translatedText ? { translatedText: edited } : {}),
        },
      }),
      { title: "Note confirmed", description: "While this stage is behind, the buyer's page shows the delay." },
    );
  }

  const categoryId = `category-${issue.id}`;
  const translationId = `translation-${issue.id}`;

  return (
    <article className="panel panel-body note-card">
      <div className="note-meta">
        <div>
          <Link to={`/orders/${issue.order.id}`} className="po">
            {issue.order.poNumber}
          </Link>
          <span className="muted">
            {" "}
            {issue.order.style}, {issue.order.colour}, for {issue.order.buyer.name}
          </span>
        </div>
        <span className="small muted">
          {STAGE_LABEL[issue.stage]}, {shortDate(issue.workDate)}, {issue.supervisor}
        </span>
      </div>

      <div className="note-compare">
        <div className="field">
          <span className="label">Supervisor wrote</span>
          {issue.originalText ? (
            <p className="note-original" lang="ta">
              {issue.originalText}
            </p>
          ) : (
            <p className="muted">No typed note</p>
          )}
          {issue.voiceUrl && <audio controls preload="none" src={issue.voiceUrl} className="note-audio" />}
          {issue.photoUrl && (
            <a href={issue.photoUrl} target="_blank" rel="noreferrer" className="small">
              Open photo
            </a>
          )}
        </div>
        <div className="field">
          <label htmlFor={translationId}>{reviewable && issue.translatedText ? "English, AI translation you can edit" : "English"}</label>
          {reviewable ? (
            <textarea
              id={translationId}
              className="input"
              maxLength={1000}
              value={translation}
              placeholder={issue.aiStatus === "PENDING" ? "Waiting for the AI" : "Type the meaning in English"}
              onChange={(event) => setTranslation(event.target.value)}
            />
          ) : (
            <p>{issue.translatedText ?? <span className="muted">None</span>}</p>
          )}
        </div>
      </div>

      <AiLine issue={issue} />

      {reviewable ? (
        <div className="note-actions">
          <div className="field">
            <label htmlFor={categoryId}>Reason category</label>
            <Select
              id={categoryId}
              placeholder="Choose a category"
              value={category}
              options={CATEGORIES.map((value) => ({ value, label: CATEGORY_LABEL[value] }))}
              onChange={(value) => setCategory(value as IssueCategory)}
            />
          </div>
          <div className="row">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={confirm}>
              Confirm
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() =>
                void run(() => api(`/issues/${issue.id}/review`, { method: "POST", body: { action: "DISMISS" } }), {
                  title: "Note dismissed",
                  description: "It stays here under Dismissed and never reaches the buyer.",
                })
              }
            >
              Dismiss
            </button>
            {issue.aiStatus === "FAILED" && issue.originalText && (
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => void run(() => api(`/issues/${issue.id}/retry`, { method: "POST" }))}
              >
                Ask the AI again
              </button>
            )}
          </div>
        </div>
      ) : (
        issue.finalCategory && <p className="small">Category: {CATEGORY_LABEL[issue.finalCategory]}</p>
      )}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}

export default function Notes() {
  const { refreshPending } = useOutletContext<ShellContext>();
  const [params, setParams] = useSearchParams();
  const status = (params.get("status") as IssueStatus | null) ?? "PENDING";
  const issues = useLoad(() => api<{ issues: Issue[] }>(`/issues?status=${status}`), status);
  const accuracy = useLoad(() => api<{ reviewed: number; agreed: number }>("/issues/accuracy"), "accuracy");

  const reading = issues.data?.issues.some((issue) => issue.aiStatus === "PENDING");
  const reload = issues.reload;
  useEffect(() => {
    if (!reading) return;
    const timer = window.setInterval(() => void reload(), AI_POLL_MS);
    return () => window.clearInterval(timer);
  }, [reading, reload]);

  async function changed() {
    await Promise.all([issues.reload(), accuracy.reload(), refreshPending()]);
  }

  return (
    <main className="page page-medium">
      <div className="page-head">
        <div>
          <h1>Notes to review</h1>
          <p className="small muted">A buyer sees a delay reason only after you confirm the note.</p>
        </div>
        {accuracy.data && accuracy.data.reviewed > 0 && (
          <p className="small muted">
            You kept the AI's category on {accuracy.data.agreed} of {accuracy.data.reviewed} notes
          </p>
        )}
      </div>

      <div className="status-filter" role="group" aria-label="Filter notes" style={{ marginBottom: "var(--s3)" }}>
        {TABS.map((tab) => (
          <button
            key={tab.status}
            type="button"
            className="chip"
            aria-pressed={status === tab.status}
            onClick={() => setParams(tab.status === "PENDING" ? {} : { status: tab.status }, { replace: true })}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {issues.error && !issues.data ? (
        <LoadError error={issues.error} onRetry={() => void issues.reload()} />
      ) : !issues.data ? (
        <SkeletonRows rows={3} height={160} />
      ) : issues.data.issues.length === 0 ? (
        <p className="notice">
          {status === "PENDING"
            ? "Nothing to review. Notes from supervisors appear here as they come in."
            : status === "CONFIRMED"
              ? "No notes confirmed yet."
              : "No notes dismissed."}
        </p>
      ) : (
        <div className="stack">
          {issues.data.issues.map((issue) => (
            <IssueCard key={issue.id} issue={issue} onChanged={changed} />
          ))}
        </div>
      )}
    </main>
  );
}
