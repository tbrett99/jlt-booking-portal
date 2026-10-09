import { describe, expect, it } from "vitest";
import { academyQuizCsvTemplate, parseMultipleChoiceQuizCsv, QuizCsvImportError } from "../shared/academy-quiz-csv";

describe("Academy multiple-choice quiz CSV import", () => {
  it("parses the downloaded template with numbered option columns", () => {
    const questions = parseMultipleChoiceQuizCsv(academyQuizCsvTemplate);

    expect(questions).toHaveLength(2);
    expect(questions[0]).toMatchObject({
      prompt: "What does ATOL protection cover?",
      answerOptions: ["Package holidays", "Only travel insurance", "Hotel upgrades", "Airport parking"],
      correctAnswerIndex: 0,
    });
  });

  it("accepts a single pipe-delimited Options column and matching correct text", () => {
    const questions = parseMultipleChoiceQuizCsv([
      "Question,Options,Correct Option,Explanation",
      'Which supplier is best for families?,"Supplier A|Supplier B|Supplier C",Supplier B,"Check the rationale, including commas"',
    ].join("\n"));

    expect(questions[0]).toMatchObject({
      answerOptions: ["Supplier A", "Supplier B", "Supplier C"],
      correctAnswerIndex: 1,
      explanation: "Check the rationale, including commas",
    });
  });

  it("rejects the entire import with clear row errors before persistence", () => {
    expect(() => parseMultipleChoiceQuizCsv([
      "Question,Option 1,Option 2,Correct Option",
      "A valid question,One,Two,3",
      "No,One,,1",
    ].join("\n"))).toThrow(QuizCsvImportError);

    try {
      parseMultipleChoiceQuizCsv([
        "Question,Option 1,Option 2,Correct Option",
        "A valid question,One,Two,3",
        "No,One,,1",
      ].join("\n"));
    } catch (error) {
      expect(error).toBeInstanceOf(QuizCsvImportError);
      expect((error as QuizCsvImportError).rowErrors).toEqual(expect.arrayContaining([
        expect.stringContaining("Row 2: Correct Option"),
        expect.stringContaining("Row 3: Question"),
        expect.stringContaining("Row 3: Add at least two"),
      ]));
    }
  });

  it("requires the exact template headings needed to build a quiz", () => {
    expect(() => parseMultipleChoiceQuizCsv("Title,Answer\nTest,One")).toThrow("The CSV headings need attention.");
  });
});
