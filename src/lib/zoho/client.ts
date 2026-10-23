/**
 * Minimal Zoho Books client: just what placing a purchase order needs.
 * Server-side only. The refresh token and client secret never leave this module or reach a URL.
 * `fetch` is injected so tests never touch the network.
 */
export const ZOHO_DATA_CENTRES = ["com", "eu", "in", "com.au", "jp", "ca", "sa", "com.cn"] as const;
export type ZohoDataCentre = (typeof ZOHO_DATA_CENTRES)[number];

export interface ZohoConfig {
  dc: ZohoDataCentre;
  orgId: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

/** null when any credential is missing or the data centre is unknown, which keeps the feature switched off. */
export function zohoConfigFromEnv(env: Record<string, string | undefined>): ZohoConfig | null {
  const dc = env.ZOHO_DC?.trim();
  const orgId = env.ZOHO_ORG_ID?.trim();
  const clientId = env.ZOHO_CLIENT_ID?.trim();
  const clientSecret = env.ZOHO_CLIENT_SECRET?.trim();
  const refreshToken = env.ZOHO_REFRESH_TOKEN?.trim();
  if (!dc || !orgId || !clientId || !clientSecret || !refreshToken) return null;
  if (!(ZOHO_DATA_CENTRES as readonly string[]).includes(dc)) return null;
  return { dc: dc as ZohoDataCentre, orgId, clientId, clientSecret, refreshToken };
}

export type ZohoErrorCode = "AUTH" | "API" | "TIMEOUT" | "NETWORK";

export class ZohoError extends Error {
  constructor(
    readonly code: ZohoErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ZohoError";
  }
}

export interface PurchaseOrderInput {
  vendorId: string;
  itemId: string;
  quantity: number;
  /** Stored as reference_number so a retry can find an order that was created but never recorded. */
  reference: string;
  /** YYYY-MM-DD */
  date: string;
  notes?: string;
}

export interface ZohoOrderRef {
  id: string;
  number: string;
}

export interface ZohoItem {
  itemId: string;
  name: string;
  sku: string;
  unit: string;
  active: boolean;
  /** Only filled by getItem: the list endpoint does not return these. */
  vendorId?: string;
  reorderLevel?: number;
  /** Custom fields by lower-cased label, e.g. "perishability". */
  customFields?: Record<string, string>;
}

export interface ZohoClient {
  /** Every item in the organisation, following pagination. */
  listItems(): Promise<ZohoItem[]>;
  getItem(itemId: string): Promise<ZohoItem | null>;
  findVendorId(name: string): Promise<string | null>;
  findItemId(sku: string): Promise<string | null>;
  findPurchaseOrderByReference(reference: string): Promise<ZohoOrderRef | null>;
  createPurchaseOrder(input: PurchaseOrderInput): Promise<ZohoOrderRef>;
}

const TIMEOUT_MS = 10_000;

export function createZohoClient(config: ZohoConfig, fetchFn: typeof fetch = fetch): ZohoClient {
  let token: { value: string; expiresAt: number } | null = null;

  async function send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetchFn(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      if (e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError")) {
        throw new ZohoError("TIMEOUT", "Zoho Books did not answer in time.");
      }
      throw new ZohoError("NETWORK", "Zoho Books could not be reached.");
    }
  }

  async function accessToken(): Promise<string> {
    if (token && token.expiresAt > Date.now() + 60_000) return token.value;
    const res = await send(`https://accounts.zoho.${config.dc}/oauth/v2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: config.refreshToken,
      }).toString(),
    });
    const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
    if (!res.ok || !data.access_token) {
      throw new ZohoError("AUTH", `Zoho rejected the saved credentials${data.error ? ` (${data.error})` : ""}. Create a new refresh token and update ZOHO_REFRESH_TOKEN.`);
    }
    token = { value: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
    return token.value;
  }

  async function api<T>(method: "GET" | "POST", path: string, query: Record<string, string> = {}, body?: unknown): Promise<T> {
    const url = new URL(`https://www.zohoapis.${config.dc}/books/v3${path}`);
    url.searchParams.set("organization_id", config.orgId);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const res = await send(url.toString(), {
      method,
      headers: { Authorization: `Zoho-oauthtoken ${await accessToken()}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = (await res.json().catch(() => ({}))) as T & { code?: number; message?: string };
    if (res.status === 401) {
      token = null;
      throw new ZohoError("AUTH", "Zoho Books refused the access token. Check the app's scopes and the organisation id.");
    }
    if (!res.ok || (typeof data.code === "number" && data.code !== 0)) {
      throw new ZohoError("API", data.message || `Zoho Books returned HTTP ${res.status}.`);
    }
    return data;
  }

  type RawItem = {
    item_id: string;
    name?: string;
    sku?: string;
    unit?: string;
    status?: string;
    vendor_id?: string;
    reorder_level?: string | number | null;
    custom_fields?: { label?: string; value?: unknown }[];
  };
  const toItem = (r: RawItem): ZohoItem => {
    const reorder = r.reorder_level === null || r.reorder_level === undefined || r.reorder_level === "" ? undefined : Number(r.reorder_level);
    const custom: Record<string, string> = {};
    for (const f of r.custom_fields ?? []) if (f.label && f.value !== undefined && f.value !== null && String(f.value).trim()) custom[f.label.trim().toLowerCase()] = String(f.value).trim();
    return {
      itemId: r.item_id,
      name: (r.name ?? "").trim(),
      sku: (r.sku ?? "").trim(),
      unit: (r.unit ?? "").trim(),
      active: r.status !== "inactive",
      vendorId: r.vendor_id ? String(r.vendor_id) : undefined,
      reorderLevel: reorder !== undefined && Number.isFinite(reorder) ? reorder : undefined,
      customFields: custom,
    };
  };

  return {
    async listItems() {
      const out: ZohoItem[] = [];
      for (let page = 1; page <= 50; page++) {
        const data = await api<{ items?: RawItem[]; page_context?: { has_more_page?: boolean } }>("GET", "/items", { page: String(page), per_page: "200" });
        out.push(...(data.items ?? []).map(toItem));
        if (!data.page_context?.has_more_page) break;
      }
      return out;
    },

    async getItem(itemId) {
      try {
        const data = await api<{ item?: RawItem }>("GET", `/items/${encodeURIComponent(itemId)}`);
        return data.item ? toItem(data.item) : null;
      } catch (e) {
        if (e instanceof ZohoError && e.code === "API" && /not exist|not found/i.test(e.message)) return null;
        throw e;
      }
    },

    async findVendorId(name) {
      const data = await api<{ contacts?: { contact_id: string; contact_name: string }[] }>("GET", "/contacts", { contact_type: "vendor", contact_name: name });
      const wanted = name.trim().toLowerCase();
      return data.contacts?.find((c) => c.contact_name.trim().toLowerCase() === wanted)?.contact_id ?? null;
    },

    async findItemId(sku) {
      const data = await api<{ items?: { item_id: string; sku?: string }[] }>("GET", "/items", { search_text: sku });
      return data.items?.find((i) => i.sku === sku)?.item_id ?? null;
    },

    async findPurchaseOrderByReference(reference) {
      const data = await api<{ purchaseorders?: { purchaseorder_id: string; purchaseorder_number: string; reference_number?: string }[] }>("GET", "/purchaseorders", {
        reference_number: reference,
      });
      const hit = data.purchaseorders?.find((p) => p.reference_number === reference);
      return hit ? { id: hit.purchaseorder_id, number: hit.purchaseorder_number } : null;
    },

    async createPurchaseOrder(input) {
      const data = await api<{ purchaseorder?: { purchaseorder_id: string; purchaseorder_number: string } }>("POST", "/purchaseorders", {}, {
        vendor_id: input.vendorId,
        date: input.date,
        reference_number: input.reference,
        ...(input.notes ? { notes: input.notes } : {}),
        line_items: [{ item_id: input.itemId, quantity: input.quantity }],
      });
      if (!data.purchaseorder) throw new ZohoError("API", "Zoho Books accepted the request but returned no purchase order.");
      return { id: data.purchaseorder.purchaseorder_id, number: data.purchaseorder.purchaseorder_number };
    },
  };
}

/** Client for this deployment, or null when Zoho is not configured. */
export function getZohoClient(): ZohoClient | null {
  const config = zohoConfigFromEnv(process.env);
  return config ? createZohoClient(config) : null;
}
