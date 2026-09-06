/**
 * Talking to the platform.
 *
 * Every request carries the session cookie and every failure arrives as the
 * same shape, so a screen branches on a stable name and shows a sentence a
 * person wrote. A fetch that throws a bare `TypeError` because the server is
 * down is turned into that shape too: "could not be reached" is a state the
 * interface has to draw, not an exception it gets to ignore.
 *
 * The browser sets `Origin` on everything that is not a GET, which is what the
 * server checks. There is no CSRF token to carry, because there is nothing for
 * one to protect that the origin check does not already.
 */

/** What the platform answered when it could not do what was asked. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }

  /** Whether this is the platform saying to sign in again. */
  get needsSignIn(): boolean {
    return this.status === 401;
  }
}

async function send<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  let answer: Response;
  try {
    answer = await fetch(`/api/v1${path}`, {
      method,
      // Same origin, so the cookie travels. Stated rather than relied upon,
      // because the default differs between browsers and bundlers.
      credentials: "same-origin",
      headers: body === undefined
        ? { accept: "application/json" }
        : { accept: "application/json", "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(
      0,
      "unreachable",
      "The platform could not be reached. Check that the server is running."
    );
  }
  if (answer.status === 204) return undefined as T;
  if (!answer.ok) {
    let code = "request_failed";
    let detail = `The platform answered ${answer.status}.`;
    try {
      const failed = await answer.json();
      code = failed.error ?? code;
      detail = failed.detail ?? detail;
    } catch {
      // A body that is not JSON leaves the status as the whole story.
    }
    throw new ApiError(answer.status, code, detail);
  }
  return (await answer.json()) as T;
}

export const get = <T,>(path: string): Promise<T> => send<T>("GET", path);
export const post = <T,>(path: string, body?: unknown): Promise<T> =>
  send<T>("POST", path, body ?? {});
export const patch = <T,>(path: string, body: unknown): Promise<T> =>
  send<T>("PATCH", path, body);
export const put = <T,>(path: string, body: unknown): Promise<T> =>
  send<T>("PUT", path, body);
export const del = <T,>(path: string): Promise<T> => send<T>("DELETE", path);

/** Builds a query string, leaving out what was not asked for. */
export function search(
  params: Record<string, string | number | boolean | undefined | null>
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "" && value !== null && value !== false) {
      query.set(key, String(value));
    }
  }
  const rendered = query.toString();
  return rendered ? `?${rendered}` : "";
}
