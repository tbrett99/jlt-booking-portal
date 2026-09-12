import { beforeEach, describe, expect, it, vi } from "vitest";

const selectResults: unknown[][] = [];
const selectChain = () => {
  const chain: any = {
    from: () => chain,
    where: () => chain,
    limit: vi.fn(async () => selectResults.shift() ?? []),
    then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(selectResults.shift() ?? []).then(resolve, reject),
  };
  return chain;
};
const insertValues = vi.fn(async () => [{ insertId: 702 }]);
const updateWhere = vi.fn(async () => undefined);
const updateSet = vi.fn(() => ({ where: updateWhere }));
const db = {
  select: vi.fn(() => selectChain()),
  insert: vi.fn(() => ({ values: insertValues })),
  update: vi.fn(() => ({ set: updateSet })),
};

vi.mock("./db", () => ({
  getDb: vi.fn(async () => db),
  createBooking: vi.fn(),
  updateBookingAdminFields: vi.fn(),
  getBookingById: vi.fn(),
}));

import { externalApiRouter } from "./external-api";

const payload = {
  agentId: "JLT-123",
  externalPublicationId: "b1a2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5",
  title: "New York and Finger Lakes Escape",
  summary: "A public-only itinerary snapshot built to inspire a thoughtful travel conversation.",
  destination: "New York and Finger Lakes",
  durationNights: 7,
  price: { mode: "from", amount: 1495, currency: "GBP", perPerson: true },
  heroImage: { url: "https://supplier.example/hero.jpg", source: "supplier" },
  itineraryImages: [{ url: "https://supplier.example/elser-hotel.jpg", source: "supplier" as const, label: "The Elser Hotel Miami", category: "hotel" as const }],
  curatedSections: [{ id: "d2a3c4b5-e6f7-4a8b-9c0d-e1f2a3b4c5d6", kind: "stay" as const, title: "A considered city stay", summary: "A relaxed city base with the right balance of location, character and time to explore.", facts: ["5 nights", "Bed & Breakfast"], images: [{ url: "https://supplier.example/stay.jpg", source: "supplier" as const, label: "The Elser Hotel Miami", category: "hotel" as const }] }],
  itinerary: [{ day: 1, title: "Arrive in New York", highlights: ["Private airport transfer"] }],
  accommodationOptions: [],
  inclusions: ["Selected accommodation"],
  practicalNotes: ["Subject to availability"],
};

function intakeHandler() {
  const layer = (externalApiRouter as any).stack.find((item: any) => item.route?.path === "/quote-showcases");
  if (!layer) throw new Error("quote-showcases route was not registered");
  return layer.route.stack[0].handle as (req: any, res: any) => Promise<void>;
}

function response() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = vi.fn((statusCode: number) => { res.statusCode = statusCode; return res; });
  res.json = vi.fn((body: unknown) => { res.body = body; return res; });
  return res;
}

describe("POST /api/external/quote-showcases", () => {
  beforeEach(() => {
    selectResults.splice(0, selectResults.length);
    vi.clearAllMocks();
  });

  it("rejects unauthenticated payloads before reading or storing any data", async () => {
    const res = response();
    await intakeHandler()({ headers: {}, body: payload }, res);
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: "Missing X-API-Key header" });
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("stores a one-time strict public snapshot and returns only the Portal URL", async () => {
    selectResults.push(
      [{ id: 4, keyHash: "hash", isActive: true }],
      [{ userId: 19, agentStatus: "active", inContract: false }],
      [{ id: 77, publicSlug: "alex-travel-19", isPublished: true }],
      [],
    );
    const res = response();
    await intakeHandler()({ headers: { "x-api-key": "valid-key" }, body: payload }, res);
    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual(expect.objectContaining({ success: true, showcaseId: 702, publicUrl: expect.stringContaining("/travel-agents/alex-travel-19/holiday-showcases/") }));
    expect(insertValues).toHaveBeenNthCalledWith(1, expect.objectContaining({
      agentId: 19,
      publicProfileId: 77,
      externalPublicationId: payload.externalPublicationId,
      itineraryImages: payload.itineraryImages,
      curatedSections: payload.curatedSections,
      sourceSnapshot: payload,
    }));
  });

  it("returns the original record for a repeated external publication ID without duplicating it", async () => {
    selectResults.push(
      [{ id: 4, keyHash: "hash", isActive: true }],
      [{ userId: 19, agentStatus: "active", inContract: false }],
      [{ id: 77, publicSlug: "alex-travel-19", isPublished: true }],
      [{ id: 501, agentId: 19, publicSlug: "new-york-a1b2c" }],
    );
    const res = response();
    await intakeHandler()({ headers: { "x-api-key": "valid-key" }, body: payload }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, idempotent: true, showcaseId: 501, publicUrl: "https://www.thejltgroup.co.uk/travel-agents/alex-travel-19/holiday-showcases/new-york-a1b2c" });
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("accepts an approved super-admin public profile by numeric Portal user ID when no CRM identifier exists", async () => {
    selectResults.push(
      [{ id: 4, keyHash: "hash", isActive: true }],
      [{ id: 47, role: "super_admin", isActive: true }],
      [{ id: 88, publicSlug: "max-kelly", isPublished: true }],
      [],
    );
    const res = response();
    await intakeHandler()({ headers: { "x-api-key": "valid-key" }, body: { ...payload, agentId: 47 } }, res);
    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual(expect.objectContaining({ success: true, showcaseId: 702, publicUrl: expect.stringContaining("/travel-agents/max-kelly/holiday-showcases/") }));
    expect(insertValues).toHaveBeenNthCalledWith(1, expect.objectContaining({ agentId: 47, publicProfileId: 88 }));
  });

  it("does not allow a numeric Portal user ID to bypass the standard-agent CRM eligibility path", async () => {
    selectResults.push(
      [{ id: 4, keyHash: "hash", isActive: true }],
      [{ id: 19, role: "agent", isActive: true }],
    );
    const res = response();
    await intakeHandler()({ headers: { "x-api-key": "valid-key" }, body: { ...payload, agentId: 19 } }, res);
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: "A numeric agentId can only be used by an active approved staff public profile." });
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("rejects unsafe payload fields after authenticating without storing a showcase", async () => {
    selectResults.push([{ id: 4, keyHash: "hash", isActive: true }]);
    const res = response();
    await intakeHandler()({ headers: { "x-api-key": "valid-key" }, body: { ...payload, clientName: "Private customer" } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual(expect.objectContaining({
      error: "Invalid public holiday showcase payload at payload: Unexpected field; remove fields not defined by the public showcase contract.",
      validationErrors: expect.arrayContaining([expect.objectContaining({ path: "payload", code: "unrecognized_keys", message: expect.any(String) })]),
    }));
    expect(res.body).not.toHaveProperty("fields");
    expect(JSON.stringify(res.body)).not.toContain("Private customer");
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("accepts Orbit's documented curatedSections-only story and returns safe validation fields for malformed public data", async () => {
    selectResults.push(
      [{ id: 4, keyHash: "hash", isActive: true }],
      [{ userId: 19, agentStatus: "active", inContract: false }],
      [{ id: 77, publicSlug: "alex-travel-19", isPublished: true }],
      [],
    );
    const res = response();
    const curatedOnly = { ...payload, itinerary: [] };
    await intakeHandler()({ headers: { "x-api-key": "valid-key" }, body: curatedOnly }, res);
    expect(res.statusCode).toBe(201);
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({ curatedSections: payload.curatedSections }));

    selectResults.push([{ id: 4, keyHash: "hash", isActive: true }]);
    const invalid = response();
    await intakeHandler()({ headers: { "x-api-key": "valid-key" }, body: { ...payload, curatedSections: [{ ...payload.curatedSections[0], kind: "unknown" }] } }, invalid);
    expect(invalid.statusCode).toBe(400);
    expect(invalid.body).toEqual(expect.objectContaining({
      error: "Invalid public holiday showcase payload at curatedSections[0].kind: Value is not one of the allowed public contract options.",
      validationErrors: expect.arrayContaining([expect.objectContaining({ path: "curatedSections[0].kind", code: expect.any(String), message: expect.any(String) })]),
    }));
    expect(JSON.stringify(invalid.body)).not.toContain("Private customer");
  });
});
