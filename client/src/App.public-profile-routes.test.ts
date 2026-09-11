import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("admin public-profile routes", () => {
  it("makes the self-service public-profile editor available in the default admin portal view", () => {
    const source = readFileSync(resolve(process.cwd(), "client/src/App.tsx"), "utf8");
    const defaultAdminView = source.slice(source.indexOf("// Admin / Super Admin — default admin view"));

    expect(defaultAdminView).toContain('<Route path="/my-profile" component={MyProfile} />');
    expect(defaultAdminView).toContain('<Route path="/my-public-profile" component={MyPublicProfile} />');
  });
});
