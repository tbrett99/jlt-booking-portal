import { describe, expect, it } from "vitest";
import { buildInvokePayload, parseInvokeResponseBody } from "./_core/llm";

describe("LLM helper provider compatibility", () => {
  const messages = [{ role: "user" as const, content: "Return a compact review." }];

  it("forwards only the model-specific OpenAI controls supplied by the caller", () => {
    const payload = buildInvokePayload({
      model: "gpt-5.5",
      messages,
      reasoning: { effort: "low" },
      max_completion_tokens: 4_000,
      response_format: { type: "json_object" },
    });

    expect(payload).toMatchObject({
      model: "gpt-5.5",
      reasoning: { effort: "low" },
      max_completion_tokens: 4_000,
      response_format: { type: "json_object" },
    });
    expect(payload).not.toHaveProperty("thinking");
    expect(payload).not.toHaveProperty("max_tokens");
  });

  it("does not impose incompatible provider controls on ordinary calls", () => {
    const payload = buildInvokePayload({ messages });
    expect(payload).toMatchObject({ model: "gemini-2.5-flash" });
    expect(payload).not.toHaveProperty("thinking");
    expect(payload).not.toHaveProperty("reasoning");
    expect(payload).not.toHaveProperty("max_tokens");
    expect(payload).not.toHaveProperty("max_completion_tokens");
  });

  it("turns an HTTP-200 proxy error envelope into a real failure", () => {
    expect(() =>
      parseInvokeResponseBody({
        error: { code: "unsupported_parameter", message: "thinking is not supported for this model" },
      })
    ).toThrow("unsupported_parameter");
    expect(() => parseInvokeResponseBody({ id: "incomplete" })).toThrow(
      "no completion choices"
    );
  });
});
