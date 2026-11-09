import { BellRing, Camera, Check, CircleCheck, CloudOff, CloudUpload, LogOut, Mic, Square, TriangleAlert } from "lucide-react";
import { Brand } from "../components/Brand";
import { StageIcon } from "../components/StageIcon";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError, NetworkError } from "../lib/api";
import { pieces, shortDate } from "../lib/format";
import { LanguageToggle, useLanguage, type StringKey } from "../lib/i18n";
import { useNotifications } from "../lib/notifications";
import { useSession } from "../lib/session";
import type { Worklist } from "../lib/types";
import { canRecordVoice, compressPhoto, startRecording, type Recording } from "../offline/media";
import { localDate, newUpdateId, viewStages, workDateFor, type StageView } from "../offline/queue";
import type { QueuedUpdate, SavedWorklist } from "../offline/store";
import { offlineStore, useQueue } from "../offline/useQueue";

const RELOAD_MS = 30_000;

const REJECT_TEXT: Record<string, StringKey> = {
  OVER_QUANTITY: "rejectOver",
  WRONG_UNIT: "rejectUnit",
  FUTURE_DATE: "rejectDate",
  TOO_OLD: "rejectOld",
  TOO_LATE: "rejectLate",
  NOT_FOUND: "rejectGone",
  NOT_QUANTITY_STAGE: "rejectGone",
  FILE_REFUSED: "rejectFile",
};

/** "Thu 5 Nov", in the supervisor's language. */
function useDayLabel(): (date: string) => string {
  const { language } = useLanguage();
  return (date) =>
    new Intl.DateTimeFormat(language === "ta" ? "ta-IN" : "en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }).format(new Date(`${date}T00:00:00Z`));
}

/** Empty is allowed; anything else must be a whole number of pieces. */
function readCount(value: string): number | null | "invalid" {
  if (value.trim() === "") return null;
  const count = Number(value);
  return Number.isInteger(count) && count >= 0 ? count : "invalid";
}

function UpdateForm({
  stage,
  workDate,
  userId,
  onSubmit,
  onCancel,
}: {
  stage: StageView;
  workDate: string;
  userId: string;
  onSubmit(updates: QueuedUpdate[]): Promise<void>;
  onCancel(): void;
}) {
  const { t } = useLanguage();
  const dayLabel = useDayLabel();
  const [missedQty, setMissedQty] = useState("");
  const [qty, setQty] = useState(stage.queued ? String(stage.queued.qty) : stage.shownTodayQty === null ? "" : String(stage.shownTodayQty));
  const [note, setNote] = useState(stage.queued?.noteText ?? "");
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [voice, setVoice] = useState<Blob | null>(null);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const recorder = useRef<Recording | null>(null);

  useEffect(() => () => recorder.current?.cancel(), []);

  useEffect(() => {
    if (!photo) {
      setPhotoPreview(null);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      setPhoto(await compressPhoto(file));
    } catch {
      setError(t("photoFailed"));
    }
  }

  async function toggleRecording() {
    setError(null);
    if (recorder.current) {
      const finished = recorder.current;
      recorder.current = null;
      setRecording(false);
      setVoice(await finished.stop());
      return;
    }
    try {
      recorder.current = await startRecording();
      setRecording(true);
    } catch {
      setError(t("micDenied"));
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const count = readCount(qty);
    // The missed day is optional: a supervisor who doesn't know the number leaves it empty.
    const missed = stage.missedDate ? readCount(missedQty) : null;
    if (count === "invalid" || missed === "invalid" || (count === null && missed === null)) {
      setError(t("enterNumber"));
      return;
    }
    if ((count ?? 0) + (missed ?? 0) > stage.maxToday) {
      setError(`${t("tooMany")} ${pieces(stage.maxToday)}.`);
      return;
    }
    setBusy(true);
    let voiceBlob = voice;
    if (recorder.current) {
      const finished = recorder.current;
      recorder.current = null;
      setRecording(false);
      voiceBlob = await finished.stop();
    }
    await send(count, missed, voiceBlob);
  }

  async function send(count: number | null, missed: number | null, voiceBlob: Blob | null) {
    const capturedAt = new Date().toISOString();
    const base = { userId, milestoneId: stage.milestoneId, capturedAt, enteredOn: workDate, state: "PENDING" as const };
    const updates: QueuedUpdate[] = [];
    // Each count is saved under its own day, so the pace stays true. The note and files describe today.
    if (missed !== null && stage.missedDate) {
      updates.push({ ...base, id: newUpdateId(), workDate: stage.missedDate, qty: missed });
    }
    if (count !== null) {
      updates.push({
        ...base,
        id: newUpdateId(),
        workDate,
        qty: count,
        noteText: note.trim() || undefined,
        photo: photo ?? undefined,
        voice: voiceBlob ?? undefined,
      });
    }
    await onSubmit(updates);
  }

  const qtyId = `qty-${stage.milestoneId}`;
  const missedId = `missed-${stage.milestoneId}`;
  const noteId = `note-${stage.milestoneId}`;
  const photoId = `photo-${stage.milestoneId}`;

  return (
    <form className="floor-form" onSubmit={(event) => void submit(event)}>
      {stage.missedDate && (
        <div className="field floor-missed-field">
          <label htmlFor={missedId}>
            {t("missedDayCount")} {dayLabel(stage.missedDate)}
          </label>
          <input
            id={missedId}
            className="input floor-qty"
            type="number"
            inputMode="numeric"
            min={0}
            autoFocus
            value={missedQty}
            aria-describedby={`${missedId}-hint`}
            onChange={(event) => setMissedQty(event.target.value)}
          />
          <span id={`${missedId}-hint`} className="small">
            {t("missedDayHint")}
          </span>
        </div>
      )}
      <div className="field">
        <label htmlFor={qtyId}>{t("todayCount")}</label>
        <input
          id={qtyId}
          className="input floor-qty"
          type="number"
          inputMode="numeric"
          enterKeyHint="send"
          min={0}
          autoFocus={!stage.missedDate}
          value={qty}
          aria-describedby={`${qtyId}-hint`}
          onChange={(event) => setQty(event.target.value)}
        />
        <span id={`${qtyId}-hint`} className="small muted">
          {t("maxHint")} {pieces(stage.maxToday)}
        </span>
      </div>
      <div className="field">
        <label htmlFor={noteId}>{t("noteLabel")}</label>
        <textarea
          id={noteId}
          className="input"
          lang="ta"
          maxLength={1000}
          placeholder={t("notePlaceholder")}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>
      <div className="floor-attach">
        <label className="btn floor-btn" htmlFor={photoId}>
          <Camera size={20} aria-hidden="true" />
          {photo ? t("changePhoto") : t("addPhoto")}
        </label>
        <input
          id={photoId}
          className="visually-hidden"
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(event) => void pickPhoto(event.target.files?.[0])}
        />
        {canRecordVoice() && !voice && (
          <button
            type="button"
            className={recording ? "btn btn-danger floor-btn" : "btn floor-btn"}
            onClick={() => void toggleRecording()}
          >
            {recording ? <Square size={18} aria-hidden="true" /> : <Mic size={20} aria-hidden="true" />}
            {recording ? t("stopRecording") : t("recordVoice")}
          </button>
        )}
      </div>
      {recording && (
        <p className="small" role="status">
          {t("recording")}
        </p>
      )}
      {photo && (
        <div className="row small">
          {photoPreview && <img className="floor-thumb" src={photoPreview} alt="" width={56} height={56} />}
          <button type="button" className="linklike" onClick={() => setPhoto(null)}>
            {t("removePhoto")}
          </button>
        </div>
      )}
      {voice && (
        <div className="row small">
          <span>{t("voiceAdded")}</span>
          <button type="button" className="linklike" onClick={() => setVoice(null)}>
            {t("removeVoice")}
          </button>
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="floor-actions">
        <button type="submit" className="btn btn-primary floor-btn" disabled={busy}>
          {t("send")}
        </button>
        <button type="button" className="btn floor-btn" onClick={onCancel}>
          {t("cancel")}
        </button>
      </div>
    </form>
  );
}

const DAY_MS = 86_400_000;

/** How the due date reads at a glance: a word for today and tomorrow, a count otherwise. */
function useDue(plannedDate: string, workDate: string): { text: string; tone: "late" | "soon" | "calm" } {
  const { t } = useLanguage();
  const left = Math.round((Date.parse(`${plannedDate}T00:00:00Z`) - Date.parse(`${workDate}T00:00:00Z`)) / DAY_MS);
  if (left < 0) return { text: `${-left} ${t("daysLate")}`, tone: "late" };
  if (left === 0) return { text: t("dueToday"), tone: "soon" };
  if (left === 1) return { text: t("dueTomorrow"), tone: "soon" };
  return { text: `${left} ${t("daysLeft")}`, tone: "calm" };
}

function StageCard({
  stage,
  workDate,
  open,
  onOpen,
  children,
}: {
  stage: StageView;
  workDate: string;
  open: boolean;
  onOpen(): void;
  children: React.ReactNode;
}) {
  const { t, stage: stageName } = useLanguage();
  const dayLabel = useDayLabel();
  const percent = stage.plannedQty === 0 ? 0 : Math.min((stage.shownDoneQty / stage.plannedQty) * 100, 100);
  const waiting = stage.queued?.state === "PENDING";
  const reported = stage.shownTodayQty !== null;
  const due = useDue(stage.plannedDate, workDate);

  return (
    <li className={reported && !open ? "panel floor-card is-reported" : "panel floor-card"}>
      <div className="floor-card-top">
        <StageIcon stage={stage.stage} />
        <div className="floor-card-title">
          <h2>{stageName(stage.stage)}</h2>
          <p className="small muted" lang="en">
            {stage.poNumber} · {stage.style}, {stage.colour}
          </p>
        </div>
        <span className={`due-tag due-${due.tone}`} title={`${t("due")} ${shortDate(stage.plannedDate)}`}>
          {due.text}
        </span>
      </div>
      <div className="floor-progress" aria-hidden="true">
        <span style={{ width: `${percent}%` }} />
      </div>
      <p className="floor-figures">
        <span>
          <strong>{pieces(stage.shownDoneQty)}</strong> {t("of")} {pieces(stage.plannedQty)}
        </span>
        <span className="muted small nowrap">
          {pieces(Math.max(stage.plannedQty - stage.shownDoneQty, 0))} {t("piecesLeft")}
        </span>
      </p>
      {open ? (
        children
      ) : (
        <div className="floor-today">
          {stage.missedDate && (
            <p className="floor-missed">
              <TriangleAlert size={18} aria-hidden="true" />
              <span>
                {t("missedDayWarning")} <strong>{dayLabel(stage.missedDate)}</strong>
              </span>
            </p>
          )}
          {stage.shownTodayQty !== null && (
            <p className={waiting ? "floor-entered is-waiting" : "floor-entered"}>
              {waiting ? <CloudUpload size={18} aria-hidden="true" /> : <Check size={18} strokeWidth={3} aria-hidden="true" />}
              <span>
                {t("entered")}: <strong>{pieces(stage.shownTodayQty)}</strong>
              </span>
              <span className="floor-entered-state">{waiting ? t("waitingToSend") : t("sent")}</span>
            </p>
          )}
          <button
            type="button"
            className={stage.shownTodayQty === null || stage.missedDate ? "btn btn-primary floor-btn" : "btn floor-btn"}
            onClick={onOpen}
          >
            {stage.missedDate ? t("missedDayButton") : stage.shownTodayQty === null ? t("enterToday") : t("changeToday")}
          </button>
        </div>
      )}
    </li>
  );
}

export default function Floor() {
  const { user, signOut } = useSession();
  const { t, stage: stageName, language } = useLanguage();
  const userId = user?.id ?? "";
  const [saved, setSaved] = useState<SavedWorklist | null>(null);
  // navigator.onLine stays true on a weak signal, so a failed request is the real test.
  const [unreachable, setUnreachable] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const worklist = await api<Worklist>("/supervisor/worklist");
      const next = { worklist, fetchedOn: localDate(new Date()) };
      setSaved(next);
      setUnreachable(false);
      setLoadFailed(false);
      await offlineStore.saveWorklist(userId, next);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return;
      setUnreachable(error instanceof NetworkError);
      const stored = await offlineStore.loadWorklist(userId);
      if (stored) setSaved(stored);
      else setLoadFailed(true);
    }
  }, [userId]);

  const queue = useQueue(userId, () => void load());
  const notifications = useNotifications();

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!unreachable) return;
    const retry = () => void load();
    const timer = window.setInterval(retry, RELOAD_MS);
    window.addEventListener("online", retry);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", retry);
    };
  }, [unreachable, load]);

  const offline = !queue.online || unreachable;
  const pending = queue.updates.filter((update) => update.state === "PENDING");
  const rejected = queue.updates.filter((update) => update.state === "REJECTED");
  const workDate = saved ? workDateFor(saved, localDate(new Date())) : "";
  const stages = saved ? viewStages(saved.worklist, queue.updates, workDate) : [];

  const anyMissed = stages.some((stage) => stage.missedDate !== null);
  // The missed-day reminder stays only while a stage still needs that count; the card does the asking.
  const reminders = notifications.items.filter(
    (item) => !item.read && (item.kind === "MISSED_COUNT" || (item.kind === "MISSED_YESTERDAY" && anyMissed)),
  );
  const settledReminders =
    saved && !anyMissed ? notifications.items.filter((item) => !item.read && item.kind === "MISSED_YESTERDAY") : [];
  const settledIds = settledReminders.map((item) => item.id).join();

  useEffect(() => {
    // Once every missed count is in, its reminder has done its job.
    for (const id of settledIds.split(",").filter(Boolean)) void notifications.markRead(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settledIds]);

  const reportedCount = stages.filter((stage) => stage.shownTodayQty !== null).length;
  const longDate = workDate
    ? new Intl.DateTimeFormat(language === "ta" ? "ta-IN" : "en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
        timeZone: "UTC",
      }).format(new Date(`${workDate}T00:00:00Z`))
    : "";

  function rejectionText(update: QueuedUpdate): string {
    const key = update.rejectCode ? REJECT_TEXT[update.rejectCode] : undefined;
    return key ? t(key) : (update.rejectMessage ?? t("rejectGone"));
  }

  function stageOf(update: QueuedUpdate): StageView | undefined {
    return stages.find((stage) => stage.milestoneId === update.milestoneId);
  }

  return (
    <div className="floor">
      <header className="floor-head">
        <div className="floor-head-inner">
          <div className="floor-top">
            <span className="brand">
              <Brand />
            </span>
            <div className="floor-actions-top">
              <LanguageToggle />
              <button
                type="button"
                className="linklike"
                aria-label={t("signOut")}
                onClick={() => (queue.updates.length > 0 ? setConfirmSignOut(true) : void signOut())}
              >
                <LogOut size={18} aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="floor-hello">
            <p className="floor-name">{user?.name}</p>
            <h1>{t("todaysWork")}</h1>
            {longDate && <p className="floor-date">{longDate}</p>}
          </div>

          {stages.length > 0 && (
            <div className="floor-tally">
              <span className="floor-tally-stitches" aria-hidden="true">
                {stages.map((stage) => (
                  <span key={stage.milestoneId} className={stage.shownTodayQty !== null ? "is-done" : ""} />
                ))}
              </span>
              <span>
                <strong>
                  {reportedCount} / {stages.length}
                </strong>{" "}
                {t("reportedToday")}
              </span>
            </div>
          )}

          <div className="floor-sync" role="status">
            {offline ? (
              <span className="sync-pill sync-offline">
                <CloudOff size={16} aria-hidden="true" />
                {t("syncOffline")}
                {pending.length > 0 && ` · ${pending.length} ${t("syncSaved")}`}
              </span>
            ) : pending.length > 0 ? (
              <button type="button" className="sync-pill sync-waiting" disabled={queue.sending} onClick={() => void queue.flush()}>
                <CloudUpload size={16} aria-hidden="true" />
                {pending.length} {t("waitingToSend")} · {queue.sending ? t("sending") : t("sendNow")}
              </button>
            ) : reportedCount === 0 ? null : (
              <span className="sync-pill sync-ok">
                <CircleCheck size={16} aria-hidden="true" />
                {t("syncAllSent")}
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="floor-main stack">
        {confirmSignOut && (
          <div className="notice notice-warn stack" role="alert">
            <p>{t("signOutWarning")}</p>
            <div className="row">
              <button type="button" className="btn floor-btn" onClick={() => void signOut()}>
                {t("signOutAnyway")}
              </button>
              <button type="button" className="btn btn-primary floor-btn" onClick={() => setConfirmSignOut(false)}>
                {t("keepSignedIn")}
              </button>
            </div>
          </div>
        )}

        {reminders.map((item) => (
          <section key={item.id} className="floor-reminder" role="status">
            <BellRing size={22} aria-hidden="true" />
            <div className="floor-reminder-text">
              <h2>{item.title}</h2>
              <p>{item.body}</p>
            </div>
            <button type="button" className="btn btn-small" onClick={() => void notifications.markRead(item.id)}>
              {t("gotIt")}
            </button>
          </section>
        ))}

        {offline && (
          <p className="notice notice-warn">
            {pending.length > 0 ? t("willSendLater") : t("offline")}{" "}
            {saved && unreachable ? `${t("savedCopy")} (${shortDate(saved.fetchedOn)})` : ""}
          </p>
        )}

        {rejected.length > 0 && (
          <section className="notice notice-error stack" aria-labelledby="attention-heading">
            <h2 id="attention-heading">{t("needsAttention")}</h2>
            {rejected.map((update) => {
              const stage = stageOf(update);
              return (
                <div key={update.id} className="stack" style={{ gap: "var(--s2)" }}>
                  <p>
                    {stage && (
                      <strong>
                        {stageName(stage.stage)}, {stage.poNumber}:{" "}
                      </strong>
                    )}
                    {pieces(update.qty)}. {rejectionText(update)}
                  </p>
                  <div className="row">
                    {stage && (
                      <button type="button" className="btn btn-small" onClick={() => setOpenId(stage.milestoneId)}>
                        {t("fixAndResend")}
                      </button>
                    )}
                    {confirmDiscard === update.id ? (
                      <>
                        <button type="button" className="btn btn-small btn-danger" onClick={() => void queue.discard(update.id)}>
                          {t("confirmDiscard")}
                        </button>
                        <button type="button" className="btn btn-small" onClick={() => setConfirmDiscard(null)}>
                          {t("keep")}
                        </button>
                      </>
                    ) : (
                      <button type="button" className="btn btn-small" onClick={() => setConfirmDiscard(update.id)}>
                        {t("discard")}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </section>
        )}

        {loadFailed && !saved ? (
          <div className="notice notice-error stack" role="alert">
            <p>{t("loadFailed")}</p>
            <div>
              <button type="button" className="btn floor-btn" onClick={() => void load()}>
                {t("tryAgain")}
              </button>
            </div>
          </div>
        ) : !saved ? (
          <div className="stack" aria-busy="true">
            <div className="skeleton" style={{ height: 150 }} />
            <div className="skeleton" style={{ height: 150 }} />
          </div>
        ) : stages.length === 0 ? (
          <p className="notice">{t("noWork")}</p>
        ) : (
          <ul className="floor-list">
            {stages.map((stage) => (
              <StageCard
                key={stage.milestoneId}
                stage={stage}
                workDate={workDate}
                open={openId === stage.milestoneId}
                onOpen={() => setOpenId(stage.milestoneId)}
              >
                <UpdateForm
                  stage={stage}
                  workDate={workDate}
                  userId={userId}
                  onCancel={() => setOpenId(null)}
                  onSubmit={async (updates) => {
                    for (const update of updates) await queue.add(update);
                    setOpenId(null);
                  }}
                />
              </StageCard>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
