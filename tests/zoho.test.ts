import { describe, expect, it } from "vitest";
import { createZohoClient, zohoConfigFromEnv, ZohoError, type ZohoConfig } from "@/lib/zoho/client";

const CONFIG: ZohoConfig = { dc: "in", orgId: "60001", clientId: "cid", clientSecret: "secret", refreshToken: "refresh" };

interface Call {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

/** Scripted fetch: answers token requests itself and hands every API call to `api`. */
function fakeFetch(api: (call: Call) => { status?: number; json: unknown }) {
  const calls: Call[] = [];
  let tokens = 0;
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      url: new URL(String(input)),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body === undefined ? undefined : String(init.body),
    };
    calls.push(call);
    if (call.url.pathname === "/oauth/v2/token") {
      tokens += 1;
      return Response.json({ access_token: `tok-${tokens}`, expires_in: 3600 });
    }
    const out = api(call);
    return Response.json(out.json, { status: out.status ?? 200 });
  }) as typeof fetch;
  return { fn, calls, tokenRequests: () => tokens };
}

describe("zohoConfigFromEnv", () => {
  const full = {
    ZOHO_DC: "in",
    ZOHO_ORG_ID: "60001",
    ZOHO_CLIENT_ID: "cid",
    ZOHO_CLIENT_SECRET: "secret",
    ZOHO_REFRESH_TOKEN: "refresh",
  };

  it("returns null until every credential is set, so the feature stays off", () => {
    expect(zohoConfigFromEnv({})).toBeNull();
    expect(zohoConfigFromEnv({ ...full, ZOHO_REFRESH_TOKEN: "" })).toBeNull();
  });

  it("reads a complete configuration", () => {
    expect(zohoConfigFromEnv(full)).toEqual(CONFIG);
  });

  it("rejects an unknown data centre instead of calling a made-up host", () => {
    expect(zohoConfigFromEnv({ ...full, ZOHO_DC: "evil.example" })).toBeNull();
  });
});

describe("Zoho client", () => {
  it("refreshes the token on the regional accounts host and reuses it", async () => {
    const f = fakeFetch(() => ({ json: { code: 0, contacts: [] } }));
    const zoho = createZohoClient(CONFIG, f.fn);
    await zoho.findVendorId("A");
    await zoho.findVendorId("B");
    const token = f.calls.find((c) => c.url.pathname === "/oauth/v2/token")!;
    expect(token.url.host).toBe("accounts.zoho.in");
    expect(token.method).toBe("POST");
    const form = new URLSearchParams(token.body);
    expect(Object.fromEntries(form)).toMatchObject({ grant_type: "refresh_token", client_id: "cid", client_secret: "secret", refresh_token: "refresh" });
    expect(f.tokenRequests()).toBe(1);
  });

  it("sends the token in the header and the organisation as a query parameter, never the secret", async () => {
    const f = fakeFetch(() => ({ json: { code: 0, contacts: [] } }));
    await createZohoClient(CONFIG, f.fn).findVendorId("NutriFlow Distributors");
    const api = f.calls.find((c) => c.url.pathname.startsWith("/books/v3"))!;
    expect(api.url.host).toBe("www.zohoapis.in");
    expect(api.url.searchParams.get("organization_id")).toBe("60001");
    expect(api.headers.Authorization).toBe("Zoho-oauthtoken tok-1");
    expect(api.url.toString()).not.toMatch(/secret|refresh/);
  });

  it("finds a vendor only on an exact, case-insensitive name match", async () => {
    const f = fakeFetch(() => ({
      json: {
        code: 0,
        contacts: [
          { contact_id: "1", contact_name: "NutriFlow Distributors Pvt Ltd" },
          { contact_id: "2", contact_name: "nutriflow distributors" },
        ],
      },
    }));
    expect(await createZohoClient(CONFIG, f.fn).findVendorId("NutriFlow Distributors")).toBe("2");
    const api = f.calls.find((c) => c.url.pathname === "/books/v3/contacts")!;
    expect(api.url.searchParams.get("contact_type")).toBe("vendor");
  });

  it("returns null when the vendor does not exist", async () => {
    const f = fakeFetch(() => ({ json: { code: 0, contacts: [{ contact_id: "1", contact_name: "Someone Else" }] } }));
    expect(await createZohoClient(CONFIG, f.fn).findVendorId("NutriFlow Distributors")).toBeNull();
  });

  it("finds an item by its exact SKU code", async () => {
    const f = fakeFetch(() => ({
      json: {
        code: 0,
        items: [
          { item_id: "10", sku: "SKU0011" },
          { item_id: "11", sku: "SKU001" },
        ],
      },
    }));
    expect(await createZohoClient(CONFIG, f.fn).findItemId("SKU001")).toBe("11");
  });

  it("creates a purchase order with the reference, date and one line, and returns its id and number", async () => {
    const f = fakeFetch(() => ({ status: 201, json: { code: 0, purchaseorder: { purchaseorder_id: "900", purchaseorder_number: "PO-00042" } } }));
    const po = await createZohoClient(CONFIG, f.fn).createPurchaseOrder({
      vendorId: "2",
      itemId: "11",
      quantity: 750,
      reference: "FR-abc",
      date: "2026-10-23",
      notes: "Approved by Raghav",
    });
    expect(po).toEqual({ id: "900", number: "PO-00042" });
    const api = f.calls.find((c) => c.method === "POST" && c.url.pathname === "/books/v3/purchaseorders")!;
    expect(JSON.parse(api.body!)).toEqual({
      vendor_id: "2",
      date: "2026-10-23",
      reference_number: "FR-abc",
      notes: "Approved by Raghav",
      line_items: [{ item_id: "11", quantity: 750 }],
    });
  });

  it("finds an order that already carries a reference, to avoid a duplicate", async () => {
    const f = fakeFetch(() => ({
      json: { code: 0, purchaseorders: [{ purchaseorder_id: "900", purchaseorder_number: "PO-00042", reference_number: "FR-abc" }] },
    }));
    expect(await createZohoClient(CONFIG, f.fn).findPurchaseOrderByReference("FR-abc")).toEqual({ id: "900", number: "PO-00042" });
    const api = f.calls.find((c) => c.url.pathname === "/books/v3/purchaseorders")!;
    expect(api.url.searchParams.get("reference_number")).toBe("FR-abc");
  });

  it("lists every item across pages", async () => {
    const f = fakeFetch((c) => {
      const page = c.url.searchParams.get("page");
      return page === "1"
        ? { json: { code: 0, items: [{ item_id: "1", name: "A", sku: "SKU001", unit: "pcs", status: "active" }], page_context: { has_more_page: true } } }
        : { json: { code: 0, items: [{ item_id: "2", name: "B", sku: "SKU002", status: "inactive" }], page_context: { has_more_page: false } } };
    });
    const items = await createZohoClient(CONFIG, f.fn).listItems();
    expect(items.map((i) => [i.itemId, i.sku, i.active])).toEqual([["1", "SKU001", true], ["2", "SKU002", false]]);
  });

  it("reads vendor, reorder level and custom fields from an item", async () => {
    const f = fakeFetch(() => ({
      json: { code: 0, item: { item_id: "9", name: "Oats", sku: "SKU099", unit: "pcs", status: "active", vendor_id: "V2", reorder_level: "250", custom_fields: [{ label: "Perishability", value: "High" }] } },
    }));
    expect(await createZohoClient(CONFIG, f.fn).getItem("9")).toMatchObject({ itemId: "9", vendorId: "V2", reorderLevel: 250, customFields: { perishability: "High" } });
  });

  it("surfaces the Zoho error message", async () => {
    const f = fakeFetch(() => ({ status: 400, json: { code: 1001, message: "Item rate is required." } }));
    const err = await createZohoClient(CONFIG, f.fn)
      .createPurchaseOrder({ vendorId: "2", itemId: "11", quantity: 1, reference: "r", date: "2026-10-23" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ZohoError);
    expect(err).toMatchObject({ code: "API", message: expect.stringContaining("Item rate is required.") });
  });

  it("reports a bad refresh token as an authorisation problem", async () => {
    const fn = (async () => Response.json({ error: "invalid_code" })) as typeof fetch;
    const err = await createZohoClient(CONFIG, fn).findVendorId("x").catch((e) => e);
    expect(err).toMatchObject({ code: "AUTH" });
  });

  it("maps a network timeout to a TIMEOUT error", async () => {
    const fn = (async () => {
      throw new DOMException("timed out", "TimeoutError");
    }) as typeof fetch;
    const err = await createZohoClient(CONFIG, fn).findVendorId("x").catch((e) => e);
    expect(err).toMatchObject({ code: "TIMEOUT" });
  });
});
