import { describe, expect, it } from "vitest";
import {
  normaliseCorrespondenceEmailKind,
  selectCorrespondenceAddress,
} from "./agent-correspondence";

describe("agent correspondence email selection", () => {
  it("uses the selected usable CRM email", () => {
    expect(selectCorrespondenceAddress({
      kind: "business",
      businessEmail: "  hello@agency.example ",
      loginEmail: "login@example.com",
    })).toEqual({ email: "hello@agency.example", source: "business" });
  });

  it("safely falls back to the login address if the chosen CRM email is missing", () => {
    expect(selectCorrespondenceAddress({
      kind: "jlt",
      jltEmail: null,
      loginEmail: "login@example.com",
      fallbackEmail: "caller@example.com",
    })).toEqual({ email: "login@example.com", source: "login_fallback" });
  });

  it("falls back to the supplied recipient for profiles without a preference", () => {
    expect(selectCorrespondenceAddress({
      kind: null,
      loginEmail: null,
      fallbackEmail: "caller@example.com",
    })).toEqual({ email: "caller@example.com", source: "caller_fallback" });
  });

  it("only accepts the three explicit CRM correspondence choices", () => {
    expect(normaliseCorrespondenceEmailKind("personal")).toBe("personal");
    expect(normaliseCorrespondenceEmailKind("login")).toBeNull();
    expect(normaliseCorrespondenceEmailKind("anything_else")).toBeNull();
  });
});
