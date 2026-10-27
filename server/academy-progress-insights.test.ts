import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const routerSource = readFileSync(
  resolve(process.cwd(), "server/academy-router.ts"),
  "utf8"
);
const managerSource = readFileSync(
  resolve(process.cwd(), "client/src/pages/admin/AdminAcademy.tsx"),
  "utf8"
);
const insightsSource = readFileSync(
  resolve(
    process.cwd(),
    "client/src/pages/admin/AdminAcademyProgressInsights.tsx"
  ),
  "utf8"
);
const appSource = readFileSync(
  resolve(process.cwd(), "client/src/App.tsx"),
  "utf8"
);
const navigationSource = readFileSync(
  resolve(process.cwd(), "client/src/components/PortalLayout.tsx"),
  "utf8"
);

describe("Academy Progress & Insights separation", () => {
  it("provides server-side LMS metrics without a new schema dependency", () => {
    expect(routerSource).toContain("insights: adminProcedure.input");
    expect(routerSource).toContain("inactive7Plus");
    expect(routerSource).toContain("supportLocks");
    expect(routerSource).toContain("averageSecondsPerRecordedLearner");
    expect(routerSource).toContain("curriculumLessons");
    expect(routerSource).toContain("firstAttemptCorrectRate");
    expect(routerSource).toContain("deriveQuestionResitStates");
  });

  it("keeps authoring separate from enrolment, marking and support operations", () => {
    expect(managerSource).toContain(
      "Learner enrolment, progress, assessment review and support locks now"
    );
    expect(managerSource).toContain("live in Academy Progress &amp; Insights.");
    expect(insightsSource).toContain("Academy Progress &amp; Insights");
    expect(insightsSource).toContain("Learner records");
    expect(insightsSource).toContain("WrittenAssessmentQueue");
    expect(insightsSource).toContain("AssessmentSupportQueue");
    expect(insightsSource).toContain("Academy enrolment");
    expect(insightsSource).toContain("Enrol an agent");
    expect(insightsSource).toContain("LearnerManager");
  });

  it("keeps written assessments oldest-first and makes the marking queue scannable", () => {
    expect(routerSource).toContain(
      "orderBy(asc(academyAssessmentAttempts.takenAt))"
    );
    expect(managerSource).toContain("Oldest submissions appear first.");
    expect(managerSource).toContain("expandedAttemptIds");
    expect(managerSource).toContain("expandedQuestionKeys");
    expect(managerSource).toContain("Expand all assessments");
    expect(managerSource).toContain("Written question {index + 1}");
  });

  it("registers a dedicated page and prevents Academy Manager remaining active beneath it", () => {
    expect(appSource).toContain('path="/admin/academy/insights"');
    expect(navigationSource).toContain('label: "Academy Progress & Insights"');
    expect(navigationSource).toContain(
      'label: "Academy Manager", href: "/admin/academy", icon: <GraduationCap size={16} />, exact: true'
    );
  });
});
