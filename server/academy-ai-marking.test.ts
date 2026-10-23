import { describe, expect, it } from "vitest";
import {
  buildAcademyAiMarkingPrompt,
  parseAcademyAiMarkingAuditMetadata,
  parseAcademyAiMarkingResponse,
  splitAcademyAiMarkingQuestions,
} from "./academy-ai-marking";

const questions = [
  { questionId: 11, prompt: "Explain the required check.", markingGuide: "Must identify the check and why it matters.", responseText: "I would complete the required check before progressing." },
  { questionId: 12, prompt: "Describe the escalation route.", markingGuide: "Name the escalation route and the trigger.", responseText: "I would escalate the issue to the support team." },
];

const review = {
  reviews: [
    { questionId: 11, suggestedScore: 80, confidence: "medium", strengths: ["Identifies the check."], missingOrIncorrect: ["Does not explain why it matters."], staffAttention: "recommended", attentionReason: "Staff should judge whether the explanation is sufficient.", suggestedFeedback: "You correctly identified the check. Please also explain why it is required before progressing." },
    { questionId: 12, suggestedScore: 75, confidence: "medium", strengths: ["Names escalation."], missingOrIncorrect: ["Does not state the trigger."], staffAttention: "recommended", attentionReason: "The escalation threshold needs staff judgement.", suggestedFeedback: "You identified the correct escalation route. Add the point at which you would use it." },
  ],
};

describe("Academy AI marking review safeguards", () => {
  it("builds a rubric-only staff review prompt without learner identity or release instructions", () => {
    const prompt = buildAcademyAiMarkingPrompt({ courseTitle: "JLT Academy", lessonTitle: "Final written exam", questions });
    expect(prompt).toContain("privateMarkingGuide");
    expect(prompt).toContain("internal staff assistant, not the final marker");
    expect(prompt).toContain("do not send a message to the learner");
    expect(prompt).not.toContain("Agent name");
  });

  it("requires exactly one well-formed suggestion for every written response", () => {
    expect(parseAcademyAiMarkingResponse(JSON.stringify(review), [11, 12])).toEqual(review.reviews);
    expect(() => parseAcademyAiMarkingResponse(JSON.stringify({ reviews: [review.reviews[0]] }), [11, 12])).toThrow("did not cover every written answer");
    expect(() => parseAcademyAiMarkingResponse(JSON.stringify({ reviews: [{ ...review.reviews[0], questionId: 999 }] }), [11])).toThrow("did not match this assessment");
  });

  it("keeps audit records parseable and breaks long exams into bounded model-review batches", () => {
    expect(parseAcademyAiMarkingAuditMetadata({ version: 1, attemptId: 7, model: "gpt-5.5", sourceQuestions: questions, suggestions: review.reviews })).toMatchObject({ attemptId: 7, suggestions: review.reviews });
    expect(splitAcademyAiMarkingQuestions(Array.from({ length: 17 }, (_, index) => ({ ...questions[0], questionId: index + 1 })))).toHaveLength(3);
  });
});
