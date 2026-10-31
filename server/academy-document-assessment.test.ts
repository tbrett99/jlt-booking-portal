import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  academyDocumentObjectKey,
  validateAcademyDocument,
} from "./academy-document-assessment";

const schema = readFileSync(resolve(process.cwd(), "drizzle/schema.ts"), "utf8");
const router = readFileSync(resolve(process.cwd(), "server/academy-router.ts"), "utf8");
const storage = readFileSync(resolve(process.cwd(), "server/storage.ts"), "utf8");
const downloadRoute = readFileSync(resolve(process.cwd(), "server/academy-document-download-routes.ts"), "utf8");
const builder = readFileSync(resolve(process.cwd(), "client/src/pages/admin/AdminAcademy.tsx"), "utf8");
const learner = readFileSync(resolve(process.cwd(), "client/src/pages/academy/AcademyCourse.tsx"), "utf8");
const insights = readFileSync(resolve(process.cwd(), "client/src/pages/admin/AdminAcademyProgressInsights.tsx"), "utf8");
const migration = readFileSync(resolve(process.cwd(), "drizzle/0168_academy-document-assessments.sql"), "utf8");

describe("Academy document assessment workflow", () => {
  it("adds only additive assessment-template and submission metadata", () => {
    expect(schema).toContain('assessmentMode: mysqlEnum("assessmentMode", ["quiz", "document_upload"])');
    expect(schema).toContain('submissionFileKey: varchar("submissionFileKey", { length: 600 })');
    expect(migration).toContain("ALTER TABLE `academy_assessment_attempts` ADD `submissionFileKey`");
    expect(migration).toContain("ALTER TABLE `academy_lessons` ADD `assessmentMode`");
    expect(migration).not.toMatch(/\bDROP\b/i);
  });

  it("accepts only bounded, recognised Office/PDF document uploads", () => {
    const pdf = Buffer.from("%PDF-1.7\nexample");
    expect(validateAcademyDocument({ fileName: "completed-assessment.pdf", mimeType: "application/pdf", bytes: pdf }).name).toBe("completed-assessment.pdf");
    expect(() => validateAcademyDocument({ fileName: "unsafe.exe", mimeType: "application/pdf", bytes: pdf })).toThrow(/\.pdf extension/);
    expect(() => validateAcademyDocument({ fileName: "not-a-real.pdf", mimeType: "application/pdf", bytes: Buffer.from("hello") })).toThrow(/could not be validated/);
    expect(academyDocumentObjectKey("submissions", [21, 34], "doc.pdf")).toMatch(/^academy\/document-assessments\/submissions\/21\/34\//);
  });

  it("stores private assessment objects encrypted and only serves them through application access checks", () => {
    expect(storage).toContain("storagePutEncrypted");
    expect(storage).toContain("aes-256-gcm");
    expect(storage).toContain("storageGetDecrypted");
    expect(downloadRoute).toContain('app.get("/api/academy/assessment-document/:token"');
    expect(downloadRoute).toContain("sdk.authenticateRequest(req)");
    expect(downloadRoute).toContain("enrollmentRow.enrollment.agentId !== user.id");
    expect(downloadRoute).toContain("scope === \"staff\"");
  });

  it("requires a reviewed template, preserves it after learner activity, and keeps document work out of quiz submission", () => {
    expect(router).toContain("uploadDocumentAssessmentTemplate: adminProcedure");
    expect(router).toContain("submitDocumentAssessment: protectedProcedure");
    expect(router).toContain("getDocumentAssessmentTemplate: protectedProcedure");
    expect(router).toContain("documentAssessmentChanged");
    expect(router).toContain("create a replacement lesson for a revised template");
    expect(router).toContain("assessmentMode === \"document_upload\") throw new TRPCError");
    expect(router).toContain("markDocumentAssessment: adminProcedure");
    expect(router).toContain("documentMarkingQueue: adminProcedure");
  });

  it("provides a download-complete-upload agent workflow and a separate staff review queue", () => {
    expect(builder).toContain("Download, complete and upload a document");
    expect(builder).toContain("Private assessment template");
    expect(learner).toContain("Document assessment");
    expect(learner).toContain("Download the template");
    expect(learner).toContain("Submit document for marking");
    expect(insights).toContain("DocumentAssessmentQueue");
    expect(insights).toContain("markDocumentAssessment");
  });
});
