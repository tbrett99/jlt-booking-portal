import { describe, expect, it } from "vitest";

describe("public Google Maps key", () => {
  it("loads the Google Maps JavaScript bootstrap using the configured key", async () => {
    const key = process.env.VITE_GOOGLE_MAPS_API_KEY;
    expect(key, "VITE_GOOGLE_MAPS_API_KEY must be configured for live agent map pins").toBeTruthy();
    const response = await fetch(`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key!)}&v=weekly&libraries=marker`);
    const body = await response.text();
    expect(response.ok).toBe(true);
    expect(body).toContain("google.maps");
  }, 20_000);
});
