// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { printMyAgreement } from "../client/src/lib/print-my-agreement";

let article: HTMLElement;
let surroundings: HTMLElement;
let frame: HTMLIFrameElement;
let printWindow: Window;
let printDocument: Document;
let focus: ReturnType<typeof vi.fn>;
let print: ReturnType<typeof vi.fn>;
let importNode: ReturnType<typeof vi.spyOn>;
let incompleteImages: boolean;
let unavailableFrame: boolean;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No print-test network requests allowed"); }));
  incompleteImages = false; unavailableFrame = false;
  focus = vi.fn(); print = vi.fn();
  surroundings = document.createElement("main");
  surroundings.innerHTML = '<aside>Account email PRIVATE_ACCOUNT_EMAIL — bank account PRIVATE_BANK_ACCOUNT — sort code PRIVATE_SORT_CODE</aside>';
  article = document.createElement("article");
  // The caller supplies an authorized article containing sanitized server HTML.
  article.innerHTML = '<h2>Saved signing content</h2><p>Saved agency agreement provision</p><dl><dt>Recorded signer</dt><dd>Recorded signing name</dd></dl><details><summary>Signing evidence details</summary><p>Stored hash reference, not re-verified</p></details>';
  surroundings.appendChild(article); document.body.appendChild(surroundings);
  const append = document.body.appendChild.bind(document.body);
  vi.spyOn(document.body, "appendChild").mockImplementation(<T extends Node>(node: T): T => {
    const result = append(node) as T;
    if (node instanceof HTMLIFrameElement) {
      frame = node;
      if (unavailableFrame) {
        Object.defineProperty(frame, "contentDocument", { configurable: true, get: () => null });
      } else {
        printWindow = frame.contentWindow!;
        printDocument = frame.contentDocument!;
        // happy-dom's blank iframe document omits HTMLDocument.images.
        Object.defineProperty(printDocument, "images", { configurable: true, get: () => printDocument.querySelectorAll("img") });
        Object.defineProperty(printWindow, "focus", { configurable: true, value: focus });
        Object.defineProperty(printWindow, "print", { configurable: true, value: print });
        const originalImport = printDocument.importNode.bind(printDocument);
        importNode = vi.spyOn(printDocument, "importNode").mockImplementation(<T extends Node>(source: T, deep?: boolean): T => {
          const clone = originalImport(source, deep);
          if (clone instanceof HTMLElement || (clone as Element).querySelectorAll) {
            (clone as Element).querySelectorAll("img").forEach(image => {
              Object.defineProperty(image, "complete", { configurable: true, get: () => !incompleteImages });
            });
          }
          return clone;
        });
      }
    }
    return result;
  });
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  document.querySelectorAll("iframe").forEach(item => item.remove()); surroundings.remove();
});
function afterprint() { printWindow.dispatchEvent(new Event("afterprint")); }
function addSignature() {
  const image = document.createElement("img");
  image.alt = "Recorded signature";
  image.src = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
  article.appendChild(image);
}

describe("printMyAgreement authorized article isolation", () => {
  it("imports only the article into a no-scripts sandbox, opens signing details, and leaves the original unchanged", async () => {
    const original = article.outerHTML;
    await printMyAgreement(article);
    expect(frame.getAttribute("sandbox")?.split(/\s+/).sort()).toEqual(["allow-modals", "allow-same-origin"]);
    expect(frame.hasAttribute("src")).toBe(false);
    expect(frame.getAttribute("aria-hidden")).toBe("true");
    expect(frame.title).toMatch(/Print your agreement record/);
    expect(printDocument.title).toBe("JLT — My signed agency terms");
    expect(importNode).toHaveBeenCalledOnce();
    expect(importNode).toHaveBeenCalledWith(article, true);
    expect(printDocument.body.children).toHaveLength(1);
    const copy = printDocument.body.firstElementChild!;
    expect(copy.tagName).toBe("ARTICLE"); expect(copy).not.toBe(article);
    expect(copy.textContent).toContain("Saved agency agreement provision");
    expect(copy.textContent).not.toMatch(/PRIVATE_|bank account|sort code|Account email/);
    expect(printDocument.querySelector("script, iframe, form, input, canvas")).toBeNull();
    expect((copy.querySelector("details") as HTMLDetailsElement).open).toBe(true);
    expect((article.querySelector("details") as HTMLDetailsElement).open).toBe(false);
    expect(article.outerHTML).toBe(original);
    expect(surroundings.textContent).toContain("PRIVATE_BANK_ACCOUNT");
    expect(focus).toHaveBeenCalledOnce(); expect(print).toHaveBeenCalledOnce();
    expect(focus.mock.invocationCallOrder[0]).toBeLessThan(print.mock.invocationCallOrder[0]);
    afterprint();
    expect(frame.isConnected).toBe(false); expect(vi.getTimerCount()).toBe(0);
    afterprint(); // Cleanup is harmless if the browser dispatches again.
    expect(article.isConnected).toBe(true);
  });

  it("prints a completed stored signature without fetching it and cleans up after print", async () => {
    addSignature(); await printMyAgreement(article);
    expect(printDocument.querySelector("img")?.getAttribute("src")).toBe(article.querySelector("img")!.getAttribute("src"));
    expect(print).toHaveBeenCalledOnce(); afterprint(); expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["load", "error"])("waits for a pending signature %s then prints with finite cleanup", async event => {
    incompleteImages = true; addSignature();
    const pending = printMyAgreement(article);
    expect(print).not.toHaveBeenCalled();
    printDocument.querySelector("img")!.dispatchEvent(new Event(event));
    await pending;
    expect(print).toHaveBeenCalledOnce();
    afterprint(); expect(frame.isConnected).toBe(false); expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds a signature that never settles at four seconds instead of hanging", async () => {
    incompleteImages = true; addSignature();
    const pending = printMyAgreement(article);
    await vi.advanceTimersByTimeAsync(3999); expect(print).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); await pending;
    expect(print).toHaveBeenCalledOnce(); afterprint(); expect(vi.getTimerCount()).toBe(0);
  });

  it("removes the iframe after two minutes if afterprint never fires, without changing source data", async () => {
    const original = article.outerHTML;
    await printMyAgreement(article);
    await vi.advanceTimersByTimeAsync(119_999); expect(frame.isConnected).toBe(true);
    await vi.advanceTimersByTimeAsync(1); expect(frame.isConnected).toBe(false);
    expect(vi.getTimerCount()).toBe(0); expect(article.outerHTML).toBe(original);
  });

  it.each(["focus", "print"])("cleans up a %s failure and returns a safe retry error", async failure => {
    const original = article.outerHTML;
    (failure === "focus" ? focus : print).mockImplementation(() => { throw new Error("PRIVATE_INTERNAL_ERROR"); });
    await expect(printMyAgreement(article)).rejects.toThrow("Printing could not be opened. Please try again.");
    expect(frame.isConnected).toBe(false); expect(vi.getTimerCount()).toBe(0);
    expect(article.outerHTML).toBe(original); expect(article.isConnected).toBe(true);
    afterprint(); expect(frame.isConnected).toBe(false);
  });

  it("removes an unavailable iframe and gives a safe error rather than copying surrounding data", async () => {
    unavailableFrame = true;
    await expect(printMyAgreement(article)).rejects.toThrow("Printing could not be opened. Please try again.");
    expect(frame.isConnected).toBe(false); expect(vi.getTimerCount()).toBe(0);
    expect(print).not.toHaveBeenCalled(); expect(article.isConnected).toBe(true);
  });
});
