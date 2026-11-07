export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/** The request never reached the server. Callers treat this as "offline", not as a refusal. */
export class NetworkError extends Error {}

export const SESSION_EXPIRED_EVENT = "tna:session-expired";

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
  form?: FormData;
  headers?: Record<string, string>;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: options.method ?? "GET",
      credentials: "same-origin",
      headers,
      body: options.form ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
    });
  } catch {
    throw new NetworkError("Could not reach the server");
  }

  if (response.status === 204 || response.status === 202) return undefined as T;

  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (data as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    if (response.status === 401 && error?.code !== "BAD_CREDENTIALS" && error?.code !== "INVALID_LINK") {
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    }
    // Dev proxies answer 5xx with no JSON when the API is down: that is unreachable, not refused.
    if (!error && response.status >= 500) throw new NetworkError("Could not reach the server");
    throw new ApiError(
      response.status,
      error?.code ?? "UNKNOWN",
      error?.message ?? "Something went wrong. Please try again",
      error?.details,
    );
  }
  return data as T;
}

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Something went wrong. Please try again";
