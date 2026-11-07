import { Camera, Check, Mic, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError, NetworkError } from "../lib/api";
import { pieces, shortDate } from "../lib/format";
import { LanguageToggle, useLanguage, type StringKey } from "../lib/i18n";
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
  NOT_FOUND: "rejectGone",
  NOT_QUANTITY_STAGE: "rejectGone",
  FILE_REFUSED: "rejectFile",
};

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
  onSubmit(update: QueuedUpdate): Promise<void>;
  onCancel(): void;
}) {
  const { t } = useLanguage();
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
    const count = Number(qty);
    if (qty.trim() === "" || !Number.isInteger(count) || count < 0) {
      setError(t("enterNumber"));
      return;
    }
    if (count > stage.maxToday) {
      setError(`${t("tooMany")} ${pieces(stage.maxToday)}.`);
      return;
    }
    setBusy(true);
    if (recorder.current) {
      const finished = recorder.current;
      recorder.current = null;
      setRecording(false);
      const blob = await finished.stop();
      await send(count, blob);
      return;
    }
    await send(count, voice);
  }

  async function send(count: number, voiceBlob: Blob | null) {
    await onSubmit({
      id: newUpdateId(),
      userId,
      milestoneId: stage.milestoneId,
      workDate,
      qty: count,
      noteText: note.trim() || undefined,
      capturedAt: new Date().toISOString(),
      photo: photo ?? undefined,
      voice: voiceBlob ?? undefined,
      state: "PENDING",
    });
  }

  const qtyId = `qty-${stage.milestoneId}`;
  const noteId = `note-${stage.milestoneId}`;
  const photoId = `photo-${stage.milestoneId}`;

  return (
    <form className="floor-form" onSubmit={(event) => void submit(event)}>
      <div className="field">
        <label htmlFor={qtyId}>{t("todayCount")}</label>
        <input
          id={qtyId}
          className="input floor-qty"
          type="number"
          inputMode="numeric"
          enterKeyHint="send"
          min={0}
          autoFocus
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

function StageCard({
  stage,
  open,
  onOpen,
  children,
}: {
  stage: StageView;
  open: boolean;
  onOpen(): void;
  children: React.ReactNode;
}) {
  const { t, stage: stageName } = useLanguage();
  const percent = stage.plannedQty === 0 ? 0 : Math.min((stage.shownDoneQty / stage.plannedQty) * 100, 100);
  const waiting = stage.queued?.state === "PENDING";

  return (
    <li className="panel floor-card">
      <div className="floor-card-head">
        <h2>{stageName(stage.stage)}</h2>
        <span className="small muted nowrap">
          {t("due")} {shortDate(stage.plannedDate)}
        </span>
      </div>
      <p className="small muted" lang="en">
        {stage.poNumber}, {stage.style}, {stage.colour}
      </p>
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
          {stage.shownTodayQty !== null && (
            <p className="small">
              {t("entered")}: <strong>{pieces(stage.shownTodayQty)}</strong>
              {waiting ? (
                <span className="floor-waiting"> · {t("waitingToSend")}</span>
              ) : (
                <span className="floor-sent">
                  <Check size={15} strokeWidth={3} aria-hidden="true" /> {t("sent")}
                </span>
              )}
            </p>
          )}
          <button
            type="button"
            className={stage.shownTodayQty === null ? "btn btn-primary floor-btn" : "btn floor-btn"}
            onClick={onOpen}
          >
            {stage.shownTodayQty === null ? t("enterToday") : t("changeToday")}
          </button>
        </div>
      )}
    </li>
  );
}

export default function Floor() {
  const { user, signOut } = useSession();
  const { t, stage: stageName } = useLanguage();
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

  function rejectionText(update: QueuedUpdate): string {
    const key = update.rejectCode ? REJECT_TEXT[update.rejectCode] : undefined;
    return key ? t(key) : (update.rejectMessage ?? t("rejectGone"));
  }

  function stageOf(update: QueuedUpdate): StageView | undefined {
    return stages.find((stage) => stage.milestoneId === update.milestoneId);
  }

  return (
    <div className="floor">
      <header className="topbar">
        <div className="topbar-inner floor-bar">
          <span className="brand">{user?.name}</span>
          <div className="user">
            <LanguageToggle />
            <button
              type="button"
              className="linklike"
              onClick={() => (queue.updates.length > 0 ? setConfirmSignOut(true) : void signOut())}
            >
              {t("signOut")}
            </button>
          </div>
        </div>
        <div className="floor-band">
          <h1>{t("todaysWork")}</h1>
          {saved && (
            <p>
              {shortDate(workDate)} · {stages.length} {stages.length === 1 ? t("oneStageOpen") : t("stagesOpen")}
            </p>
          )}
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

        {offline && (
          <p className="notice notice-warn" role="status">
            {t("offline")} {saved && unreachable ? `${t("savedCopy")} (${shortDate(saved.fetchedOn)})` : ""}
          </p>
        )}

        {pending.length > 0 && (
          <div className="notice row floor-queue" role="status">
            <span style={{ flex: 1 }}>
              <strong>{pending.length}</strong> {t("waitingToSend")}
              {offline && <span className="small muted"> · {t("willSendLater")}</span>}
            </span>
            {!offline && (
              <button type="button" className="btn btn-small" disabled={queue.sending} onClick={() => void queue.flush()}>
                {queue.sending ? t("sending") : t("sendNow")}
              </button>
            )}
          </div>
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
                open={openId === stage.milestoneId}
                onOpen={() => setOpenId(stage.milestoneId)}
              >
                <UpdateForm
                  stage={stage}
                  workDate={workDate}
                  userId={userId}
                  onCancel={() => setOpenId(null)}
                  onSubmit={async (update) => {
                    await queue.add(update);
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
