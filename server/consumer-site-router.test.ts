import { beforeEach, describe, expect, it, vi } from "vitest";

const selectResults: unknown[][] = [];
const selectChain = () => {
  const chain: any = {
    from: () => chain,
    innerJoin: () => chain,
    leftJoin: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: vi.fn(async () => selectResults.shift() ?? []),
    then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(selectResults.shift() ?? []).then(resolve, reject),
  };
  return chain;
};
const insertValues = vi.fn(async () => [{ insertId: 9001 }]);
const updateWhere = vi.fn(async () => undefined);
const updateSet = vi.fn(() => ({ where: updateWhere }));
const db = {
  select: vi.fn(() => selectChain()),
  insert: vi.fn(() => ({ values: insertValues })),
  update: vi.fn(() => ({ set: updateSet })),
  delete: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
};

vi.mock("./db", () => ({ getDb: vi.fn(async () => db) }));
vi.mock("./email", () => ({ sendDirectEmail: vi.fn(async () => ({ success: true })) }));
vi.mock("./storage", () => ({ storagePut: vi.fn() }));

import { consumerSiteRouter } from "./consumer-site-router";
import { sendDirectEmail } from "./email";

const visibleProfile = {
  id: 77,
  userId: 19,
  isPublished: true,
  publicSlug: "alex-travel-19",
  publishedSnapshot: {
    displayName: "Alex Travel",
    businessName: "Alex Travel Co",
    biography: "I create thoughtful tailor-made holidays for families and special celebrations.",
    profilePhotoUrl: null,
    listingTown: "Chester",
    townLatitude: "53.1900",
    townLongitude: "-2.8900",
    websiteUrl: "https://alex.example.co.uk",
    instagramUrl: "https://instagram.com/alextravel",
    tiktokUrl: null,
    facebookUrl: null,
    linkedinUrl: null,
    youtubeUrl: null,
    pinterestUrl: null,
  },
  publishedTagIds: [1],
  publishedEnquiryDeliveryEmail: "private.agent@example.co.uk",
};

function publicCaller() {
  return consumerSiteRouter.createCaller({ req: { ip: "198.51.100.9" }, res: {} } as any);
}

describe("consumerSite public API", () => {
  beforeEach(() => {
    selectResults.splice(0, selectResults.length);
    vi.clearAllMocks();
  });

  it("returns only explicitly approved public fields from the public list endpoint", async () => {
    selectResults.push(
      [{ profile: visibleProfile, agentStatus: "active" }],
      [],
      [{ id: 1, label: "Caribbean", category: "destination" }],
    );
    const response = await publicCaller().public.listAgents({ tagIds: [] });
    expect(response).toHaveLength(1);
    expect(response[0]).toMatchObject({ slug: "alex-travel-19", displayName: "Alex Travel", listingTown: "Chester" });
    for (const privateField of [
      "enquiryDeliveryEmail", "publishedEnquiryDeliveryEmail", "uniqueAgentId", "jltEmail", "personalEmail", "businessEmail", "mobile",
      "addressLine1", "addressLine2", "city", "postcode", "ukRegion", "bankSortCode", "bankAccountNumber", "bankAccountName",
      "membershipTier", "monthlySub", "retailerCode", "supplierPassword", "paymentExempt", "paymentExemptReason", "preferredPaymentDay",
      "emergencyContactName", "emergencyContactPhone", "idDocUrl", "idDocKey", "proofOfAddressUrl", "proofOfAddressKey", "documentUrl",
      "internalNotes", "adminNotes", "cancelChecklist", "noticeEndsAt", "cancelledAt", "suspendedAt", "suspensionReason", "inContract",
    ]) expect(response[0]).not.toHaveProperty(privateField);
  });

  it("returns the same strict allow-list from the public agent-detail endpoint", async () => {
    selectResults.push(
      [{ profile: visibleProfile, agentStatus: "active" }],
      [{ inContract: false }],
      [{ id: 1, label: "Caribbean", category: "destination" }],
    );
    const response = await publicCaller().public.getAgent({ slug: "alex-travel-19" });
    for (const privateField of [
      "enquiryDeliveryEmail", "publishedEnquiryDeliveryEmail", "uniqueAgentId", "jltEmail", "personalEmail", "businessEmail", "mobile",
      "addressLine1", "addressLine2", "city", "postcode", "ukRegion", "bankSortCode", "bankAccountNumber", "bankAccountName",
      "membershipTier", "monthlySub", "retailerCode", "supplierPassword", "paymentExempt", "paymentExemptReason", "preferredPaymentDay",
      "emergencyContactName", "emergencyContactPhone", "idDocUrl", "idDocKey", "proofOfAddressUrl", "proofOfAddressKey", "documentUrl",
      "internalNotes", "adminNotes", "cancelChecklist", "noticeEndsAt", "cancelledAt", "suspendedAt", "suspensionReason", "inContract", "reviewNote",
    ]) {
      expect(response).not.toHaveProperty(privateField);
    }
    expect(response).toMatchObject({ slug: "alex-travel-19", listingTown: "Chester", tags: [{ label: "Caribbean" }] });
  });

  it("rejects a public enquiry when the target profile is unavailable", async () => {
    selectResults.push([]);
    await expect(publicCaller().public.submitEnquiry({
      slug: "missing-agent",
      customerName: "Sam Customer",
      customerEmail: "sam@example.com",
      customerPhone: null,
      travelBrief: "I would like help arranging a special family holiday next summer.",
      consentConfirmed: true,
    })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(sendDirectEmail).not.toHaveBeenCalled();
  });

  it("records a successful direct-to-agent enquiry and sends a separate customer acknowledgement", async () => {
    selectResults.push(
      [{ profile: visibleProfile, agentStatus: "active" }],
      [{ inContract: false }],
      [],
    );
    await expect(publicCaller().public.submitEnquiry({
      slug: "alex-travel-19",
      customerName: "Sam Customer",
      customerEmail: "sam@example.com",
      customerPhone: "07123456789",
      travelBrief: "I would like help arranging a special family holiday next summer.",
      consentConfirmed: true,
    })).resolves.toEqual({ success: true });
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 19,
      profileId: 77,
      customerEmail: "sam@example.com",
      customerName: "Sam Customer",
      consentConfirmedAt: expect.any(Date),
    }));
    expect(sendDirectEmail).toHaveBeenCalledTimes(2);
    expect(sendDirectEmail).toHaveBeenNthCalledWith(1, expect.objectContaining({ toEmail: "private.agent@example.co.uk" }));
    expect(sendDirectEmail).toHaveBeenNthCalledWith(2, expect.objectContaining({ toEmail: "sam@example.com", subject: expect.stringContaining("passed your travel enquiry") }));
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ deliveryStatus: "sent", deliveredAt: expect.any(Date) }));
  });

  it("records a failed agent delivery while keeping the customer acknowledgement path independent", async () => {
    vi.mocked(sendDirectEmail).mockResolvedValueOnce({ success: false, error: "Recipient rejected" } as any).mockResolvedValueOnce({ success: true } as any);
    selectResults.push(
      [{ profile: visibleProfile, agentStatus: "active" }],
      [{ inContract: false }],
      [],
    );
    await expect(publicCaller().public.submitEnquiry({
      slug: "alex-travel-19", customerName: "Sam Customer", customerEmail: "sam@example.com", customerPhone: null,
      travelBrief: "I would like help arranging a special family holiday next summer.", consentConfirmed: true,
    })).resolves.toEqual({ success: true });
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ deliveryStatus: "failed", deliveryError: "Recipient rejected" }));
    expect(sendDirectEmail).toHaveBeenCalledTimes(2);
  });

  it("does not turn a successfully recorded enquiry into an error when customer acknowledgement delivery fails", async () => {
    vi.mocked(sendDirectEmail).mockResolvedValueOnce({ success: true } as any).mockRejectedValueOnce(new Error("Acknowledgement unavailable"));
    selectResults.push(
      [{ profile: visibleProfile, agentStatus: "active" }],
      [{ inContract: false }],
      [],
    );
    await expect(publicCaller().public.submitEnquiry({
      slug: "alex-travel-19", customerName: "Sam Customer", customerEmail: "sam@example.com", customerPhone: null,
      travelBrief: "I would like help arranging a special family holiday next summer.", consentConfirmed: true,
    })).resolves.toEqual({ success: true });
  });

  it("rate-limits a fourth public enquiry from the same IP window before sending email", async () => {
    selectResults.push(
      [{ profile: visibleProfile, agentStatus: "active" }],
      [{ inContract: false }],
      [{ id: 1 }, { id: 2 }, { id: 3 }],
    );
    await expect(publicCaller().public.submitEnquiry({
      slug: "alex-travel-19",
      customerName: "Sam Customer",
      customerEmail: "sam@example.com",
      customerPhone: null,
      travelBrief: "I would like help arranging a special family holiday next summer.",
      consentConfirmed: true,
    })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(sendDirectEmail).not.toHaveBeenCalled();
  });
});
