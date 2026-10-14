import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildAgentReadyCommissionReminderEmail,
  buildAgentReadyCommissionReminderRecipients,
} from "./commission-agent-ready-reminders";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(serverDir, "..");
const readProjectFile = (relativePath: string) =>
  readFileSync(path.join(projectDir, relativePath), "utf8");

const routerSource = readProjectFile("server/routers.ts");
const adminCommissionsSource = readProjectFile("client/src/pages/admin/AdminCommissions.tsx");

describe("agent-ready commission reminders", () => {
  it("groups all currently unclaimed bookings into one email per agent", () => {
    const recipients = buildAgentReadyCommissionReminderRecipients({
      bookings: [
        { id: 101, agentId: 10, clientName: "Avery Smith", ptsRef: "PTS-101", expectedCommission: 125.5 },
        { id: 102, agentId: 10, clientName: "Morgan Jones", topdogRef: "TD-102", expectedCommission: 80 },
        { id: 103, agentId: 20, clientName: "Riley Green", ptsRef: "PTS-103", expectedCommission: 45 },
      ],
      users: [
        { id: 10, name: "Alex Agent", email: "alex@example.com", role: "agent", isActive: true, portalStatus: "active" },
        { id: 20, name: "Riley Agent", email: "riley@example.com", role: "agent", isActive: true, portalStatus: "in_notice" },
      ],
    });

    expect(recipients).toHaveLength(2);
    const alex = recipients.find((recipient) => recipient.agentId === 10);
    expect(alex?.bookings).toHaveLength(2);

    const email = buildAgentReadyCommissionReminderEmail(alex!);
    expect(email.subject).toBe("Reminder: commission ready to claim");
    expect(email.html).toContain("Hi Alex");
    expect(email.html).toContain("PTS-101");
    expect(email.html).toContain("TD-102");
    expect(email.html).toContain("£125.50");
    expect(email.html).toContain("£80.00");
  });

  it("does not add an agent with no email address to the send queue", () => {
    const recipients = buildAgentReadyCommissionReminderRecipients({
      bookings: [{ id: 101, agentId: 10, clientName: "Avery Smith", ptsRef: "PTS-101", expectedCommission: 125 }],
      users: [{ id: 10, name: "Alex Agent", email: null, role: "agent", isActive: true, portalStatus: "active" }],
    });

    expect(recipients).toEqual([]);
  });

  it("includes the historic-import caveat and booking-message instruction", () => {
    const recipients = buildAgentReadyCommissionReminderRecipients({
      bookings: [{ id: 101, agentId: 10, clientName: "Avery <Smith>", ptsRef: "PTS-101", expectedCommission: 125 }],
      users: [{ id: 10, name: "Alex Agent", email: "alex@example.com", role: "agent", isActive: true, portalStatus: "active" }],
    });

    const email = buildAgentReadyCommissionReminderEmail(recipients[0]);
    expect(email.html).toContain("some historic booking files were imported into the Portal");
    expect(email.html).toContain("add a message to the relevant booking");
    expect(email.html).toContain("Avery &lt;Smith&gt;");
    expect(email.html).toContain("Open My Commission Claims");
  });

  it("excludes departed, inactive and non-active portal accounts from reminders", () => {
    const recipients = buildAgentReadyCommissionReminderRecipients({
      bookings: [
        { id: 101, agentId: 10, clientName: "Active Agent File", expectedCommission: 100 },
        { id: 102, agentId: 20, clientName: "Cancelled Agent File", expectedCommission: 100 },
        { id: 103, agentId: 30, clientName: "Suspended Agent File", expectedCommission: 100 },
        { id: 104, agentId: 40, clientName: "Inactive Agent File", expectedCommission: 100 },
      ],
      users: [
        { id: 10, name: "Active Agent", email: "active@example.com", role: "agent", isActive: true, portalStatus: "active" },
        { id: 20, name: "Former Agent", email: "former@example.com", role: "agent", isActive: true, portalStatus: "cancelled" },
        { id: 30, name: "Suspended Agent", email: "suspended@example.com", role: "agent", isActive: true, portalStatus: "suspended" },
        { id: 40, name: "Inactive Agent", email: "inactive@example.com", role: "agent", isActive: false, portalStatus: "active" },
      ],
    });

    expect(recipients).toHaveLength(1);
    expect(recipients[0]).toMatchObject({ agentId: 10, email: "active@example.com" });
  });

  it("uses a server-side grouped sender and a staff confirmation before delivery", () => {
    expect(routerSource).toContain("sendAgentReadyUnclaimedReminders: adminProcedure.mutation");
    expect(routerSource).toContain("sendAgentReadyCommissionReminders()");
    expect(adminCommissionsSource).toContain("Send reminders to all agents");
    expect(adminCommissionsSource).toContain("Send commission claim reminders?");
    expect(adminCommissionsSource).toContain("sendAgentReadyUnclaimedReminders.useMutation");
    expect(adminCommissionsSource).toContain("Departed, inactive, paused, suspended and onboarding accounts");
  });
});
