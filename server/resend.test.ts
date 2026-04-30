import { describe, it, expect } from "vitest";

describe("Resend API key validation", () => {
  it("should authenticate with Resend using sending-access key", async () => {
    const apiKey = process.env.RESEND_API_KEY;
    expect(apiKey, "RESEND_API_KEY must be set").toBeTruthy();

    // Send a test email to Resend's official test address — this validates the key
    // without actually delivering an email. Resend accepts sends to onboarding@resend.dev
    // for testing purposes.
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "onboarding@resend.dev",
        to: ["delivered@resend.dev"],
        subject: "API key validation test",
        text: "This is a test to validate the Resend API key.",
      }),
    });

    // 200 = sent successfully, 422 = validation error (key valid but domain not verified)
    // Both indicate the key itself is authenticated
    const body = await res.json();
    console.log("Resend response:", res.status, JSON.stringify(body));

    expect(
      [200, 201, 422].includes(res.status),
      `Expected 200/201/422 but got ${res.status}: ${JSON.stringify(body)}`
    ).toBe(true);
  });
});
