import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const app = readFileSync(resolve(process.cwd(), "client/src/App.tsx"), "utf8");
const navigation = readFileSync(resolve(process.cwd(), "client/src/components/PortalLayout.tsx"), "utf8");
const agentHome = readFileSync(resolve(process.cwd(), "client/src/pages/academy/AcademyHome.tsx"), "utf8");
const manager = readFileSync(resolve(process.cwd(), "client/src/pages/admin/AdminAcademy.tsx"), "utf8");

describe("JLT Academy interface wiring", () => {
  it("exposes Academy for agents and the manager for admins", () => {
    expect(app).toContain('<Route path="/academy" component={AcademyHome} />');
    expect(app).toContain('<Route path="/admin/academy" component={AdminAcademy} />');
    expect(navigation).toContain('{ label: "JLT Academy", href: "/academy"');
    expect(navigation).toContain('{ label: "Academy Manager", href: "/admin/academy"');
  });

  it("keeps the Academy content-ready instead of pre-populating a course", () => {
    expect(agentHome).toContain("Your learning space is almost ready");
    expect(manager).toContain("Create your first course to start building a content-ready Academy");
    expect(manager).toContain("Nothing appears to agents until the course is published");
  });

  it("provides staff controls for resources, quizzes, manual access and accreditation", () => {
    expect(manager).toContain("Downloadable resource");
    expect(manager).toContain("Knowledge-check questions");
    expect(manager).toContain("Grant Academy");
    expect(manager).toContain("Accredit");
  });
});
