// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  forgotPassword: vi.fn(),
  loginWithPassword: vi.fn(),
  invalidate: vi.fn(),
  navigate: vi.fn(),
  getLoginUrl: vi.fn(),
  useAuth: vi.fn(),
  toastError: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: mocks.useAuth }));
vi.mock("wouter", () => ({
  useLocation: () => ["/login", mocks.navigate],
  useSearch: () => "returnTo=%2Fapi%2Foauth2%2Fauthorize%3Fclient_id%3Dsynthetic",
}));
vi.mock("@/const", () => ({ getLoginUrl: mocks.getLoginUrl }));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ auth: { me: { invalidate: mocks.invalidate } } }),
    auth: {
      loginWithPassword: {
        // Deliberately do not invoke login onSuccess: no redirects or sessions.
        useMutation: () => ({
          mutate: mocks.loginWithPassword,
          isPending: false,
        }),
      },
      forgotPassword: {
        useMutation: (options: { onSuccess?: () => void }) => ({
          mutate: (input: { email: string; origin: string }) => {
            mocks.forgotPassword(input);
            // Simulate a successful generic response, never an email delivery.
            options.onSuccess?.();
          },
          isPending: false,
        }),
      },
    },
  },
}));

import LoginPage from "../client/src/pages/LoginPage";
import OAuthLoginPage from "../client/src/pages/OAuthLoginPage";

let root: Root;
let container: HTMLDivElement;
const loginEmail = "login-user@example.invalid";
const loginPassword = "synthetic-password-only";
const resetEmail = "reset-user@example.invalid";

function field(id: string) {
  const input = document.getElementById(id) as HTMLInputElement | null;
  expect(input, `input #${id}`).not.toBeNull();
  return input!;
}

function button(text: string) {
  const matches = Array.from(
    document.querySelectorAll<HTMLButtonElement>("button")
  ).filter(element => element.textContent?.trim() === text);
  expect(matches, `button ${text}`).toHaveLength(1);
  return matches[0];
}

async function click(text: string) {
  await act(async () => {
    button(text).click();
  });
}

async function fill(id: string, value: string) {
  const input = field(id);
  await act(async () => {
    // Bypass React's value tracker so the real onChange handler runs.
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(input.value).toBe(value);
}

async function render(Page: React.ComponentType) {
  await act(async () => {
    root.render(React.createElement(Page));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // Even an accidental network request must fail locally, not reach a provider.
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.fetch.mockImplementation(() => {
    throw new Error("Network access is forbidden in this isolated UI test");
  });
  mocks.useAuth.mockReturnValue({ user: null, loading: false });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const pages = [
  { name: "LoginPage", Page: LoginPage, signIn: "Sign In" },
  {
    name: "OAuthLoginPage",
    Page: OAuthLoginPage,
    signIn: "Sign In & Continue to CRM",
  },
];

describe.each(pages)("$name rendered password-reset confirmation", ({ Page, signIn }) => {
  it("shows request receipt, conditional eligibility, the submitted email and support without promising delivery", async () => {
    await render(Page);
    await fill("email", loginEmail);
    await fill("password", loginPassword);
    await click("Forgot password?");
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.body.textContent).not.toContain("Your request has been received.");
    await fill("forgot-email", resetEmail);
    await click("Send reset link");

    expect(mocks.forgotPassword).toHaveBeenCalledTimes(1);
    expect(mocks.forgotPassword).toHaveBeenCalledWith({
      email: resetEmail,
      origin: window.location.origin,
    });
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.querySelector("form")).toBeNull();
    expect(dialog.textContent).toContain("Check your inbox");
    const displayedEmail = dialog.querySelector("strong");
    expect(displayedEmail?.textContent).toBe(resetEmail);
    // Scope to the forgotSent confirmation, not the unchanged form description.
    const confirmation = displayedEmail!.closest("p")!.textContent!
      .replace(/\s+/g, " ")
      .trim();
    expect(confirmation).toBe(
      `Your request has been received. If ${resetEmail} has an eligible password-login account, check your inbox and junk folder for a reset link. Links expire in 1 hour. If nothing arrives, contact support@thejltgroup.co.uk.`
    );
    expect(confirmation).not.toMatch(
      /you['’]ll receive|you will receive|we['’]ll send|we will send|we['’]ve sent|we have sent|(?:email|link) (?:has been|was|is) sent|(?:guaranteed|successfully delivered)/i
    );
    expect(mocks.loginWithPassword).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.getLoginUrl).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalled();

    await click("Back to login");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(field("email").value).toBe(loginEmail);
    expect(field("password").value).toBe(loginPassword);
    expect(button(signIn).disabled).toBe(false);
    await click("Forgot password?");
    expect(field("forgot-email").value).toBe("");
    expect(document.querySelector('[role="dialog"]')!.textContent)
      .not.toContain("Your request has been received.");
    expect(mocks.forgotPassword).toHaveBeenCalledTimes(1);
  });

  it("keeps standard email/password fields and submits credentials unchanged", async () => {
    await render(Page);
    expect(field("email").type).toBe("email");
    expect(field("email").autocomplete).toBe("email");
    expect(field("email").required).toBe(true);
    expect(field("password").type).toBe("password");
    expect(field("password").autocomplete).toBe("current-password");
    expect(field("password").required).toBe(true);
    await fill("email", loginEmail);
    await fill("password", loginPassword);
    await click(signIn);
    expect(mocks.loginWithPassword).toHaveBeenCalledTimes(1);
    expect(mocks.loginWithPassword).toHaveBeenCalledWith({
      email: loginEmail,
      password: loginPassword,
    });
    expect(button("Signing in...").disabled).toBe(true);
    expect(mocks.forgotPassword).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.getLoginUrl).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalled();
  });
});
