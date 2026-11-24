import { describe, expect, it } from "vitest";
import { inspect } from "node:util";
import { createHqLiveConfig } from "./management-hq-live-config";
const env = {
  HQ_LIVE_SYNC_ENABLED: "true",
  HQ_LIVE_READ_ENABLED: "true",
  HQ_ORBIT_REPORTING_BASE_URL:
    "https://reporting.orbittravel.co.uk/api/management-hq",
  HQ_ORBIT_REPORTING_API_KEY: "orbit-key-" + "a".repeat(40),
  HQ_PORTAL_SYNC_TOKEN: "portal-token-" + "b".repeat(40),
};
describe("opaque server-only live configuration", () => {
  it("defaults both flags false without any source or token", () => {
    const config = createHqLiveConfig({});
    expect(config.status()).toEqual({
      syncEnabled: false,
      readEnabled: false,
      configured: false,
      configurationCode: "CONFIG_DISABLED",
      intervalSeconds: 300,
      freshnessSeconds: 900,
    });
    expect(config.authorizeTrigger("anything")).toBe(false);
    expect(() => config.createReader()).toThrow("CONFIG_INVALID");
  });
  it.each(["1", "0", "TRUE", "False", "", " true", "yes"])(
    "strict malformed flag %j fails closed",
    value => {
      const config = createHqLiveConfig({
        ...env,
        HQ_LIVE_SYNC_ENABLED: value,
      });
      expect(config.status()).toMatchObject({
        configured: false,
        configurationCode: "CONFIG_INVALID",
      });
      expect(config.authorizeTrigger(env.HQ_PORTAL_SYNC_TOKEN)).toBe(false);
    }
  );
  it.each([
    "HQ_ORBIT_REPORTING_BASE_URL",
    "HQ_ORBIT_REPORTING_API_KEY",
    "HQ_PORTAL_SYNC_TOKEN",
  ])("missing %s never creates a reader", field => {
    const input: Record<string, string | undefined> = {
      ...env,
      [field]: undefined,
    };
    const config = createHqLiveConfig(input);
    expect(config.status()).toMatchObject({
      configured: false,
      configurationCode: "CONFIG_INCOMPLETE",
      missingSettings: [field],
    });
    expect(() => config.createReader()).toThrow();
  });
  it.each([
    "HQ_ORBIT_REPORTING_BASE_URL",
    "HQ_ORBIT_REPORTING_API_KEY",
    "HQ_PORTAL_SYNC_TOKEN",
  ])(
    "empty %s exposes only its fixed name without secrets or a reader",
    field => {
      const config = createHqLiveConfig({ ...env, [field]: "" });
      expect(config.status().missingSettings).toEqual([field]);
      expect(config.authorizeTrigger(env.HQ_PORTAL_SYNC_TOKEN)).toBe(false);
      expect(() => config.createReader()).toThrow();
      const output = JSON.stringify(config.status());
      for (const secret of Object.values(env))
        if (secret.length > 10) expect(output).not.toContain(secret);
    }
  );
  it("all required missing names are ordered, bounded and ignore arbitrary secret-looking environment names", () => {
    const config = createHqLiveConfig({
      HQ_LIVE_SYNC_ENABLED: "true",
      HQ_LIVE_READ_ENABLED: "false",
      HQ_ORBIT_REPORTING_KEY: "private-decoy-key",
      ARBITRARY_SECRET: "private-decoy-value",
    });
    expect(config.status().missingSettings).toEqual([
      "HQ_ORBIT_REPORTING_BASE_URL",
      "HQ_ORBIT_REPORTING_API_KEY",
      "HQ_PORTAL_SYNC_TOKEN",
    ]);
    expect(JSON.stringify(config.status())).not.toMatch(
      /private-decoy|ARBITRARY|HQ_ORBIT_REPORTING_KEY/
    );
  });
  it("read-only diagnostics never require a Portal sync token", () => {
    const config = createHqLiveConfig({
      ...env,
      HQ_LIVE_SYNC_ENABLED: "false",
      HQ_PORTAL_SYNC_TOKEN: undefined,
      HQ_ORBIT_REPORTING_API_KEY: undefined,
    });
    expect(config.status().missingSettings).toEqual([
      "HQ_ORBIT_REPORTING_API_KEY",
    ]);
  });
  it("diagnostic status cannot mutate captured configuration and is absent when ready, disabled or invalid", () => {
    const config = createHqLiveConfig({
      ...env,
      HQ_PORTAL_SYNC_TOKEN: undefined,
    });
    expect(() =>
      (config.status().missingSettings as string[]).push("private value")
    ).toThrow();
    expect(config.status().missingSettings).toEqual(["HQ_PORTAL_SYNC_TOKEN"]);
    for (const input of [env, {}, { ...env, HQ_LIVE_SYNC_ENABLED: "TRUE" }])
      expect(createHqLiveConfig(input).status()).not.toHaveProperty(
        "missingSettings"
      );
  });
  it.each([
    "http://reporting.orbittravel.co.uk",
    "https://127.0.0.1/api",
    "https://reporting.test",
    "https://u:p@reporting.orbittravel.co.uk",
    "https://reporting.orbittravel.co.uk/api?scope=foreign",
    "https://reporting.orbittravel.co.uk:444/api",
    "https://reporting.orbittravel.co.uk/api%2Fv1",
  ])("reuses trusted adapter URL validation for %s", url => {
    expect(
      createHqLiveConfig({ ...env, HQ_ORBIT_REPORTING_BASE_URL: url }).status()
        .configurationCode
    ).toBe("CONFIG_INVALID");
  });
  it.each(["HQ_LIVE_INTERVAL_SECONDS", "HQ_LIVE_FRESHNESS_SECONDS"])(
    "validates bounded optional %s",
    field => {
      for (const value of [
        "0",
        "-1",
        "59",
        "1.5",
        "1e3",
        "900 ",
        "999999999999999999999999",
      ])
        expect(
          createHqLiveConfig({ ...env, [field]: value }).status()
            .configurationCode
        ).toBe("CONFIG_INVALID");
      expect(
        createHqLiveConfig({ ...env, [field]: "900" }).status().configured
      ).toBe(true);
    }
  );
  it("read-only config is valid without a sync token but cannot construct a reader", () => {
    const config = createHqLiveConfig({
      ...env,
      HQ_LIVE_SYNC_ENABLED: "false",
      HQ_PORTAL_SYNC_TOKEN: undefined,
    });
    expect(config.status()).toMatchObject({
      configured: true,
      readEnabled: true,
      syncEnabled: false,
    });
    expect(config.authorizeTrigger(env.HQ_PORTAL_SYNC_TOKEN)).toBe(false);
    expect(() => config.createReader()).toThrow();
  });
  it("trigger token is distinct, bounded and compared exactly; no enumerable secrets", () => {
    const config = createHqLiveConfig(env);
    expect(config.authorizeTrigger(env.HQ_PORTAL_SYNC_TOKEN)).toBe(true);
    for (const token of [
      env.HQ_ORBIT_REPORTING_API_KEY,
      env.HQ_PORTAL_SYNC_TOKEN + " ",
      null,
      {},
      "x".repeat(257),
    ])
      expect(config.authorizeTrigger(token)).toBe(false);
    for (const output of [
      JSON.stringify(config),
      inspect(config),
      JSON.stringify(config.status()),
      inspect(config.createReader()),
    ]) {
      expect(output).not.toContain(env.HQ_PORTAL_SYNC_TOKEN);
      expect(output).not.toContain(env.HQ_ORBIT_REPORTING_API_KEY);
      expect(output).not.toContain(env.HQ_ORBIT_REPORTING_BASE_URL);
    }
    expect(
      createHqLiveConfig({
        ...env,
        HQ_PORTAL_SYNC_TOKEN: env.HQ_ORBIT_REPORTING_API_KEY,
      }).status().configurationCode
    ).toBe("CONFIG_INVALID");
  });
  it("fingerprint is normalized, excludes Portal token, and changes for source/key", () => {
    const first = createHqLiveConfig(env).sourceFingerprint();
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(
      createHqLiveConfig({
        ...env,
        HQ_ORBIT_REPORTING_BASE_URL: env.HQ_ORBIT_REPORTING_BASE_URL + "/",
        HQ_PORTAL_SYNC_TOKEN: "other-token-" + "c".repeat(40),
      }).sourceFingerprint()
    ).toBe(first);
    expect(
      createHqLiveConfig({
        ...env,
        HQ_ORBIT_REPORTING_API_KEY: "other-key-" + "d".repeat(40),
      }).sourceFingerprint()
    ).not.toBe(first);
  });
});
