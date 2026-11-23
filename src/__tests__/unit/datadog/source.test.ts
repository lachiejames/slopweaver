/**
 * Every Datadog host in this file reads the synthetic `ap1` site rather than the install's own.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { datadogEnv, datadogSite, loadDatadogConfig, withDatadogSite } from "../../../datadog/source.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const API_KEY = "0123456789abcdef0123456789abcdef";
const APP_KEY = "Ab-_0123456789abcdefghijklmnopqrstuvwxyz";
const OTHER_API_KEY = "fedcba9876543210fedcba9876543210";

const homes: string[] = [];

/** A throwaway state home holding whichever Datadog secrets and profile site the case names. */
function home({ apiKey, appKey, site }: { apiKey?: string; appKey?: string; site?: string }): string {
  const dir = mkdtempSync(join(tmpdir(), "dd-source-"));
  homes.push(dir);
  mkdirSync(join(dir, "secrets"), { recursive: true });
  if (apiKey !== undefined) {
    writeFileSync(join(dir, "secrets", "datadog-api-key"), `${apiKey}\n`);
  }
  if (appKey !== undefined) {
    writeFileSync(join(dir, "secrets", "datadog-app-key"), `${appKey}\n`);
  }
  const profile = {
    displayName: "",
    gitNamespace: "",
    id: "me",
    schemaVersion: 1,
    sources: [],
    ...(site === undefined ? {} : { datadog: { site } }),
  };
  writeFileSync(join(dir, "profile.json"), JSON.stringify(profile));
  return dir;
}

afterEach(() => {
  homes.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

describe("loadDatadogConfig", () => {
  it("builds the whole config from the secrets store and profile.json, with nothing exported", () => {
    const config = unwrap(
      loadDatadogConfig({ env: {}, home: home({ apiKey: API_KEY, appKey: APP_KEY, site: "ap1.datadoghq.com" }) }),
    );
    expect(config.apiKey).toBe(API_KEY);
    expect(config.appKey).toBe(APP_KEY);
    expect(config.site).toBe("ap1.datadoghq.com");
    expect(config.consoleHost).toBe("ap1.datadoghq.com");
  });

  it("lets an exported key win over the store, so an existing shell keeps working", () => {
    const config = unwrap(
      loadDatadogConfig({
        env: { DD_API_KEY: OTHER_API_KEY },
        home: home({ apiKey: API_KEY, appKey: APP_KEY, site: "ap1.datadoghq.com" }),
      }),
    );
    expect(config.apiKey).toBe(OTHER_API_KEY);
  });

  it("reads --home B's keys, never another home's", () => {
    home({ apiKey: OTHER_API_KEY, appKey: APP_KEY, site: "us3.datadoghq.com" });
    const b = home({ apiKey: API_KEY, appKey: APP_KEY, site: "ap1.datadoghq.com" });
    const config = unwrap(loadDatadogConfig({ env: {}, home: b }));
    expect(config.apiKey).toBe(API_KEY);
    expect(config.site).toBe("ap1.datadoghq.com");
  });

  it("still refuses an unset site rather than defaulting one, with both keys stored", () => {
    const error = unwrapErr(loadDatadogConfig({ env: {}, home: home({ apiKey: API_KEY, appKey: APP_KEY }) }));
    expect(error.code).toBe("CONFIG_INVALID");
    expect(error.message).toContain("DD_SITE is not set, and it has no safe default");
    expect(error.message).toContain("profile.json's datadog.site");
  });

  it("names the store command for a key that is nowhere", () => {
    const error = unwrapErr(loadDatadogConfig({ env: {}, home: home({ appKey: APP_KEY, site: "ap1.datadoghq.com" }) }));
    expect(error.message).toContain("DD_API_KEY is not set — store it with `slopweaver secrets set datadog-api-key`");
  });
});

describe("datadogSite", () => {
  it("prefers DD_SITE over profile.json", () => {
    expect(datadogSite({ env: { DD_SITE: " us5.datadoghq.com " }, home: home({ site: "ap1.datadoghq.com" }) })).toBe(
      "us5.datadoghq.com",
    );
  });

  it("is undefined when neither names a site", () => {
    expect(datadogSite({ env: {}, home: home({}) })).toBe(undefined);
  });
});

describe("withDatadogSite", () => {
  it("fills only the site, keeping the hatch and reading no key", () => {
    const env = withDatadogSite({
      env: { SLOPWEAVER_ALLOW_DATADOG_SITE: "1" },
      home: home({ apiKey: API_KEY, site: "ap1.datadoghq.com" }),
    });
    expect(env).toEqual({ DD_SITE: "ap1.datadoghq.com", SLOPWEAVER_ALLOW_DATADOG_SITE: "1" });
  });
});

describe("datadogEnv", () => {
  it("overlays all three values from the store and profile", () => {
    const env = datadogEnv({ env: {}, home: home({ apiKey: API_KEY, appKey: APP_KEY, site: "ap1.datadoghq.com" }) });
    expect(env).toEqual({ DD_API_KEY: API_KEY, DD_APP_KEY: APP_KEY, DD_SITE: "ap1.datadoghq.com" });
  });
});
