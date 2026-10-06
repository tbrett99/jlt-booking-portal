import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const userManagementSource = readFileSync(
  resolve(import.meta.dirname, "../client/src/pages/admin/AdminUsers.tsx"),
  "utf8",
);

describe("staff role management interface", () => {
  it("gives only Super Admins a confirmed role-change control", () => {
    expect(userManagementSource).toContain("Change staff access role");
    expect(userManagementSource).toContain("Confirm role change");
    expect(userManagementSource).toContain("isSuperAdmin && u.id !== me?.id");
    expect(userManagementSource).toContain("currentRole: u.role as PortalRole");
    expect(userManagementSource).toContain("nextRole: u.role as PortalRole");
  });
});
