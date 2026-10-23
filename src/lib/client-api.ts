export interface ApiOutcome<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
  /** A safe, human-readable message for failures. */
  message?: string;
}

/** POSTs JSON and always resolves with a typed outcome, so callers never see a thrown network error. */
export async function postJson<T = unknown>(url: string, body?: unknown): Promise<ApiOutcome<T>> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as T & { message?: string; error?: string };
    return {
      ok: res.ok,
      status: res.status,
      data,
      message: res.ok ? undefined : (data.message ?? "The request failed. Nothing was changed."),
    };
  } catch {
    return { ok: false, status: 0, data: {} as T, message: "Could not reach the server. Check your connection and try again." };
  }
}
