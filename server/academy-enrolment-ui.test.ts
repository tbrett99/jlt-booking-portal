import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const insights = readFileSync(
  resolve(
    process.cwd(),
    "client/src/pages/admin/AdminAcademyProgressInsights.tsx"
  ),
  "utf8"
);
const manager = readFileSync(
  resolve(process.cwd(), "client/src/pages/admin/AdminAcademy.tsx"),
  "utf8"
);
const router = readFileSync(
  resolve(process.cwd(), "server/academy-router.ts"),
  "utf8"
);

describe("Academy enrolment journey", () => {
  it("keeps a clear enrolment panel visible in the Learners workspace", () => {
    expect(insights).toContain("Academy enrolment");
    expect(insights).toContain("Enrol an agent");
    expect(insights).toContain("academy-enrol-course");
    expect(insights).toContain("academy-enrol-agent");
    expect(insights).toContain("Enrol agent");
  });

  it("only offers published courses and explains the safe draft-course block", () => {
    expect(insights).toContain('course.status === "published"');
    expect(insights).toContain(
      "No published Academy courses are ready for enrolment."
    );
    expect(insights).toContain("Draft courses remain private and cannot");
    expect(insights).toContain("be assigned.");
  });

  it("keeps course-specific progress management below the dedicated enrolment action", () => {
    expect(insights).toContain("Academy work queue");
    expect(insights).toContain("Search, filter and open an agent’s Academy record here.");
    expect(manager).not.toContain(
      "mt-5 grid gap-2 rounded-xl border bg-muted/15 p-4 md:grid-cols-[1fr_180px_auto]"
    );
  });

  it("uses a TiDB-safe prepared enrolment insert and refuses an invalid generated ID before lookup", () => {
    const helper = router.slice(
      router.indexOf("async function enrolAgentInCourse"),
      router.indexOf("export async function enrolAgentInAcceleratorJourneys")
    );
    expect(helper).toContain("INSERT INTO academy_enrollments");
    expect(helper).toContain("getRawDbPool");
    expect(helper).toContain("Number.isSafeInteger(enrollmentId)");
    expect(helper).toContain("Academy enrolment insert did not return an ID");
    expect(helper).not.toContain("db.insert(academyEnrollments)");
  });
});
