import { NetworkError, errorMessage } from "../lib/api";

export function LoadError({ error, onRetry }: { error: unknown; onRetry(): void }) {
  const message =
    error instanceof NetworkError
      ? "Could not reach the server. Check the connection and try again."
      : errorMessage(error);
  return (
    <div className="notice notice-error row" role="alert">
      <span style={{ flex: 1 }}>{message}</span>
      <button type="button" className="btn btn-small" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

export function SkeletonRows({ rows = 4, height = 56 }: { rows?: number; height?: number }) {
  return (
    <div className="stack" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="skeleton" style={{ height }} />
      ))}
    </div>
  );
}
