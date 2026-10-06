import { describe, expect, it } from "vitest";

describe("encrypted GitHub release credential", () => {
  const token = process.env.JLT_GITHUB_RELEASE_TOKEN;
  const verifyCredential = token ? it : it.skip;

  verifyCredential("can read and push to the configured JLT Portal repository", async () => {

    const response = await fetch("https://api.github.com/repos/tbrett99/jlt-booking-portal", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    expect(response.status).toBe(200);
    const repository = await response.json() as { full_name?: string; permissions?: { push?: boolean } };
    expect(repository.full_name).toBe("tbrett99/jlt-booking-portal");
    expect(repository.permissions?.push).toBe(true);
  });
});
