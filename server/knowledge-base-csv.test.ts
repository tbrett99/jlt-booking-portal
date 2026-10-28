import { describe, expect, it } from "vitest";
import {
  KnowledgeBaseCsvImportError,
  knowledgeBaseArticleCsvTemplate,
  parseKnowledgeBaseArticleCsv,
} from "../shared/knowledge-base-csv";
import { extractLoomEmbeds, removeLoomEmailCards } from "../shared/loom-embed";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Knowledge Base bulk article CSV import", () => {
  it("accepts the template and migrates recognised Loom and SOP links into safe article HTML", () => {
    const [article] = parseKnowledgeBaseArticleCsv(knowledgeBaseArticleCsvTemplate);

    expect(article).toMatchObject({
      title: "Cancelling a LIVE hotel booking",
      status: "draft",
      isFeatured: false,
      loomUrl: "https://www.loom.com/share/replacewithyourvideoid",
      sopUrl: "https://example.com/your-online-sop",
      sopLabel: "Open the cancellation SOP",
    });
    expect(article?.contentHtml).toContain('data-library-loom="true"');
    expect(article?.contentHtml).toContain("Open the cancellation SOP");
  });

  it("supports quoted multi-line HTML and rejects the full upload before any row can be saved", () => {
    const csv = [
      "Title,Category,Content HTML,Loom URL",
      '"A valid article",Operations,"<p>First paragraph</p>\n<ul><li>Second line</li></ul>","https://www.loom.com/share/AbCd1234"',
      '"Unsafe recording",Operations,"<p>Text</p>","https://example.com/not-loom"',
    ].join("\n");

    try {
      parseKnowledgeBaseArticleCsv(csv);
      throw new Error("Expected CSV validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(KnowledgeBaseCsvImportError);
      expect((error as KnowledgeBaseCsvImportError).rowErrors).toContain("Row 3: Loom URL must be a secure loom.com share or embed URL.");
    }
  });

  it("blocks duplicate rows and invalid published status values before persistence", () => {
    const csv = [
      "Title,Category,Content HTML,Status",
      '"Repeat",General,"<p>One</p>",Published',
      '"Repeat",General,"<p>Two</p>",Live',
    ].join("\n");
    expect(() => parseKnowledgeBaseArticleCsv(csv)).toThrow("The CSV was not imported");
  });
});

describe("Knowledge Base Loom migration", () => {
  it("turns a RichEmailEditor Loom thumbnail card into one recognised in-Portal player source", () => {
    const html = '<div style="margin:24px 0"><a href="https://www.loom.com/share/AbCd1234"><img src="https://cdn.loom.com/thumb.jpg" alt="Watch video on Loom"><div>▶ Watch video on Loom</div></a></div><p>Continue with the guidance.</p>';
    expect(extractLoomEmbeds(html)).toEqual([{ id: "AbCd1234", embedUrl: "https://www.loom.com/embed/AbCd1234", shareUrl: "https://www.loom.com/share/AbCd1234" }]);
    expect(removeLoomEmailCards(html)).not.toContain("Watch video on Loom");
    expect(removeLoomEmailCards(html)).toContain("Continue with the guidance.");
  });

  it("removes the durable migration marker once its Loom player is shown", () => {
    const html = '<p data-library-loom="true"><a href="https://www.loom.com/share/AbCd1234">Watch video on Loom</a></p><p>Keep this SOP guidance.</p>';
    expect(removeLoomEmailCards(html)).not.toContain("data-library-loom");
    expect(removeLoomEmailCards(html)).toContain("Keep this SOP guidance.");
  });

  it("keeps the Knowledge Base renderer bound to recognised Loom helpers rather than arbitrary iframe markup", () => {
    const browser = readFileSync(resolve(process.cwd(), "client/src/pages/library/LibraryBrowser.tsx"), "utf8");
    expect(browser).toContain("extractLoomEmbeds");
    expect(browser).toContain("removeLoomEmailCards");
    expect(browser).toContain("<LoomPlayer");
  });
});
