import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("agent request tracker", () => {
  it("returns a booking reference and submitted date with every outstanding request type", () => {
    const router = read("server/routers.ts");
    expect(router).toContain("const bookingReferenceMap");
    expect(router).toContain("bookingReference: bookingReferenceMap.get");
    expect(router).toContain("createdAt: r.createdAt");
    expect(router).toContain('ne(amendments.status, "rejected")');
  });

  it("sends each dashboard category to a filtered tracker instead of one arbitrary booking", () => {
    const dashboard = read("client/src/pages/agent/AgentDashboard.tsx");
    expect(dashboard).toContain('href: "/my-requests?type=flights"');
    expect(dashboard).toContain('href: "/my-requests?type=amendments"');
    expect(dashboard).toContain('href: "/my-requests?type=reimbursements"');
    expect(dashboard).toContain('href: "/my-requests?type=refunds"');
    expect(dashboard).toContain('href: "/my-requests?type=cancellations"');
  });

  it("keeps a dedicated tracker available from both agent portal modes and the sidebar", () => {
    const app = read("client/src/App.tsx");
    const layout = read("client/src/components/PortalLayout.tsx");
    const tracker = read("client/src/pages/agent/AgentRequestTracker.tsx");
    expect(app).toContain('const AgentRequestTracker');
    expect((app.match(/path="\/my-requests"/g) ?? []).length).toBe(2);
    expect(layout).toContain('label: "Request Tracker"');
    expect(tracker).toContain("Request tracker");
    expect(tracker).toContain("agentOutstandingSummary.useQuery");
    expect(tracker).toContain("Booking #{row.bookingId}");
  });

  it("uses an updating search-param control for filters and valid link-button composition", () => {
    const tracker = read("client/src/pages/agent/AgentRequestTracker.tsx");
    expect(tracker).toContain("useSearchParams");
    expect(tracker).toContain("const [searchParams, setSearchParams] = useSearchParams()");
    expect(tracker).toContain("const selectType = (type: RequestType)");
    expect(tracker).toContain('onClick={() => selectType(type)}');
    expect(tracker).toContain("<Button asChild size=\"sm\" variant=\"outline\"");
    expect(tracker).not.toContain("<Link href={selectedMeta.createHref}>\n                <Button");
  });
});
