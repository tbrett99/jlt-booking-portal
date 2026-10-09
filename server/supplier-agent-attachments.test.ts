import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routerSource = readFileSync(new URL("./suppliers-router.ts", import.meta.url), "utf8");
const directorySource = readFileSync(
  new URL("../client/src/pages/SupplierDirectory.tsx", import.meta.url),
  "utf8"
);

describe("agent supplier attachments", () => {
  it("allows agents to list documents only for active supplier records", () => {
    expect(routerSource).toContain(".query(async ({ ctx, input }) => {");
    expect(routerSource).toContain("const [supplier] = await db");
    expect(routerSource).toContain("(!isAdmin && supplier.isActive !== 1)");
    expect(routerSource).toContain('message: "Supplier not found"');
  });

  it("returns agent-safe document metadata without storage management fields", () => {
    expect(routerSource).toContain("fileName: supplierAttachments.fileName");
    expect(routerSource).toContain("fileUrl: supplierAttachments.fileUrl");
    expect(routerSource).toContain("fileKey: isAdmin ? attachment.fileKey : null");
    expect(routerSource).toContain("uploadedById: isAdmin ? attachment.uploadedById : null");
  });

  it("renders supplier documents in the agent supplier profile", () => {
    expect(directorySource).toContain("trpc.suppliers.listAttachments.useQuery");
    expect(directorySource).toContain("Documents & Resources");
    expect(directorySource).toContain("href={attachment.fileUrl}");
    expect(directorySource).toContain("formatAttachmentSize(attachment.fileSize)");
  });
});
