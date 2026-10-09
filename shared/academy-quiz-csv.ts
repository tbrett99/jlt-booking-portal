export type ImportedMultipleChoiceQuestion = {
  prompt: string;
  questionType: "multiple_choice";
  answerOptions: string[];
  correctAnswerIndex: number;
  maxWords: number;
  explanation: string | null;
};

export class QuizCsvImportError extends Error {
  constructor(message: string, readonly rowErrors: string[]) {
    super(message);
    this.name = "QuizCsvImportError";
  }
}

const HEADER_ALIASES = {
  prompt: new Set(["question", "prompt", "questiontext"]),
  options: new Set(["options", "answeroptions", "answers"]),
  correct: new Set(["correctoption", "correctanswer", "correctanswerindex", "answer", "correct"]),
  explanation: new Set(["explanation", "staffnote", "note", "markingguide"]),
};

function normaliseHeader(value: string) {
  return value.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Parse RFC 4180-style CSV while preserving quoted commas and line breaks. */
export function parseCsvRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    const next = input[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (quoted) throw new QuizCsvImportError("The CSV contains an unclosed quoted value.", []);
  if (cell.length || row.length) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

function valueAt(row: string[], column: number | undefined) {
  return column === undefined ? "" : (row[column] ?? "").trim();
}

function columnFor(headers: string[], aliases: Set<string>) {
  return headers.findIndex((header) => aliases.has(header));
}

function optionColumns(headers: string[]) {
  return headers.flatMap((header, index) => {
    const match = header.match(/^(?:option|answeroption|answer)([1-8])$/);
    return match ? [{ index, position: Number(match[1]) }] : [];
  }).sort((a, b) => a.position - b.position);
}

function resolveCorrectOption(value: string, options: string[]) {
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= options.length) return numeric - 1;
  const exact = options.findIndex((option) => option.trim().toLocaleLowerCase() === value.trim().toLocaleLowerCase());
  return exact;
}

/**
 * Converts an Academy multiple-choice CSV into validated question drafts.
 * All rows are validated before any question is persisted by the caller.
 */
export function parseMultipleChoiceQuizCsv(input: string): ImportedMultipleChoiceQuestion[] {
  if (!input.trim()) throw new QuizCsvImportError("Choose a CSV file that contains a header row and at least one question.", []);
  const rows = parseCsvRows(input).filter((row) => row.some((cell) => cell.trim()));
  if (rows.length < 2) throw new QuizCsvImportError("The CSV needs a header row and at least one question row.", []);

  const headers = rows[0].map(normaliseHeader);
  const promptColumn = columnFor(headers, HEADER_ALIASES.prompt);
  const correctColumn = columnFor(headers, HEADER_ALIASES.correct);
  const explanationColumn = columnFor(headers, HEADER_ALIASES.explanation);
  const packedOptionsColumn = columnFor(headers, HEADER_ALIASES.options);
  const individualOptionColumns = optionColumns(headers);

  const headerErrors: string[] = [];
  if (promptColumn < 0) headerErrors.push("Missing a Question column.");
  if (correctColumn < 0) headerErrors.push("Missing a Correct Option column.");
  if (!individualOptionColumns.length && packedOptionsColumn < 0) headerErrors.push("Add Option 1 and Option 2 columns (up to Option 8), or one Options column using | between answers.");
  if (headerErrors.length) throw new QuizCsvImportError("The CSV headings need attention.", headerErrors);

  if (rows.length - 1 > 30) throw new QuizCsvImportError("An Academy knowledge check can contain up to 30 questions. Split this CSV into smaller uploads.", []);

  const errors: string[] = [];
  const questions = rows.slice(1).flatMap((row, rowOffset) => {
    const rowNumber = rowOffset + 2;
    const prompt = valueAt(row, promptColumn);
    const options = individualOptionColumns.length
      ? individualOptionColumns.map(({ index }) => valueAt(row, index)).filter(Boolean)
      : valueAt(row, packedOptionsColumn).split("|").map((option) => option.trim()).filter(Boolean);
    const correct = valueAt(row, correctColumn);
    const explanation = valueAt(row, explanationColumn);

    if (prompt.length < 4) errors.push(`Row ${rowNumber}: Question must contain at least 4 characters.`);
    if (prompt.length > 10_000) errors.push(`Row ${rowNumber}: Question is too long.`);
    if (options.length < 2) errors.push(`Row ${rowNumber}: Add at least two non-empty answer options.`);
    if (options.length > 8) errors.push(`Row ${rowNumber}: A question can have up to 8 answer options.`);
    if (options.some((option) => option.length > 500)) errors.push(`Row ${rowNumber}: Each answer option must be 500 characters or fewer.`);
    if (explanation.length > 10_000) errors.push(`Row ${rowNumber}: Staff note is too long.`);
    const correctAnswerIndex = resolveCorrectOption(correct, options);
    if (correctAnswerIndex < 0) errors.push(`Row ${rowNumber}: Correct Option must be an answer number (for example 2) or exactly match one of the options.`);

    if (errors.some((error) => error.startsWith(`Row ${rowNumber}:`))) return [];
    return [{ prompt, questionType: "multiple_choice" as const, answerOptions: options, correctAnswerIndex, maxWords: 250, explanation: explanation || null }];
  });

  if (errors.length) {
    const displayed = errors.slice(0, 20);
    const suffix = errors.length > displayed.length ? ` Plus ${errors.length - displayed.length} more row issue${errors.length - displayed.length === 1 ? "" : "s"}.` : "";
    throw new QuizCsvImportError(`The CSV was not imported. ${displayed.join(" ")}${suffix}`, displayed);
  }
  return questions;
}

export const academyQuizCsvTemplate = `Question,Option 1,Option 2,Option 3,Option 4,Correct Option,Explanation\nWhat does ATOL protection cover?,Package holidays,Only travel insurance,Hotel upgrades,Airport parking,1,Confirm the agent understands the basic protection.\nWhich action should be completed before submitting a booking?,Check all client details,Send a social post,Choose a logo,Order stationery,1,`;
