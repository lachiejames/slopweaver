import { describe, expect, it } from "vitest";

import {
  consoleHostFor,
  DD_SITES,
  datadogKeyPages,
  datadogSiteState,
  isDatadogConsoleHost,
  resolveDatadogConfig,
} from "../../../datadog/config.js";
import { datadogConfigErrorLines } from "../../../datadog/configErrors.js";
import { wrongDatadogSite } from "../../../datadog/siteGuard.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const API_KEY = "0123456789abcdef0123456789abcdef";
// EXAMPLE is load-bearing in every credential-shaped sample here: it is a value that is issuer-SHAPED and
// self-evidently not a credential, which also keeps it readable and out of any secret scanner's flags.
const APP_KEY = "EXAMPLE_notarealappkey_0123456789abcdefg";

const HEALTHY = { DD_API_KEY: API_KEY, DD_APP_KEY: APP_KEY, DD_SITE: "us3.datadoghq.com" };

/** Resolve a config that must fail, asserting it failed as the accumulated CONFIG_INVALID, and return its lines. */
function configErrors({ env }: { env: Readonly<Record<string, string | undefined>> }): readonly string[] {
  const error = unwrapErr(resolveDatadogConfig({ env }));
  expect(error.code).toBe("CONFIG_INVALID");
  return datadogConfigErrorLines({ error });
}

describe("resolveDatadogConfig", () => {
  it("resolves a healthy environment, deriving both hosts", () => {
    const config = unwrap(resolveDatadogConfig({ env: HEALTHY }));
    expect(config.apiKey).toBe(API_KEY);
    expect(config.appKey).toBe(APP_KEY);
    expect(config.site).toBe("us3.datadoghq.com");
    expect(config.apiHost).toBe("api.us3.datadoghq.com");
    expect(config.consoleHost).toBe("us3.datadoghq.com");
  });

  it("puts the unprefixed US site on an app. console host", () => {
    const config = unwrap(resolveDatadogConfig({ env: { ...HEALTHY, DD_SITE: "datadoghq.com" } }));
    expect(config.apiHost).toBe("api.datadoghq.com");
    expect(config.consoleHost).toBe("app.datadoghq.com");
  });

  it("pins ap2 to its own API and console hosts, never the app. subdomain the browser guard refuses", () => {
    const config = unwrap(resolveDatadogConfig({ env: { ...HEALTHY, DD_SITE: "ap2.datadoghq.com" } }));
    expect(config.site).toBe("ap2.datadoghq.com");
    expect(config.apiHost).toBe("api.ap2.datadoghq.com");
    expect(config.consoleHost).toBe("ap2.datadoghq.com");
    expect(wrongDatadogSite({ ddSite: "ap2.datadoghq.com", url: `https://${config.consoleHost}/logs` })).toBe(
      undefined,
    );
  });

  it("names DD_API_KEY when it is unset", () => {
    const errors = configErrors({ env: { ...HEALTHY, DD_API_KEY: undefined } });
    expect(errors).toEqual([
      "DD_API_KEY is not set — store it with `slopweaver secrets set datadog-api-key`, or export DD_API_KEY (32 lowercase hex characters)",
    ]);
  });

  it("treats an all-whitespace credential as unset", () => {
    const errors = configErrors({ env: { ...HEALTHY, DD_APP_KEY: "   " } });
    expect(errors).toEqual([
      "DD_APP_KEY is not set — store it with `slopweaver secrets set datadog-app-key`, or export DD_APP_KEY (40 letters, digits, underscores or dashes)",
    ]);
  });

  it("reports a malformed key by length only, never quoting the value", () => {
    const errors = configErrors({ env: { ...HEALTHY, DD_API_KEY: "deadbeef" } });
    expect(errors).toEqual([
      "DD_API_KEY is set (8 chars) but is not 32 lowercase hex characters — re-issue it rather than editing it",
    ]);
    expect(errors[0]).not.toContain("deadbeef");
  });

  it("rejects an uppercase API key, which is not the shape Datadog issues", () => {
    const errors = configErrors({ env: { ...HEALTHY, DD_API_KEY: API_KEY.toUpperCase() } });
    expect(errors).toEqual([
      "DD_API_KEY is set (32 chars) but is not 32 lowercase hex characters — re-issue it rather than editing it",
    ]);
  });

  it("accepts a mixed-case app key with an underscore, which is what a real one looks like", () => {
    const mixed = "EXAMPLE_NotARealAppKey_0123456789abcdEfg";
    const config = unwrap(resolveDatadogConfig({ env: { ...HEALTHY, DD_APP_KEY: mixed } }));
    expect(config.appKey).toBe(mixed);
  });

  it("rejects an app key of the wrong length", () => {
    const errors = configErrors({ env: { ...HEALTHY, DD_APP_KEY: "a".repeat(39) } });
    expect(errors).toEqual([
      "DD_APP_KEY is set (39 chars) but is not 40 letters, digits, underscores or dashes — re-issue it rather than editing it",
    ]);
  });

  it("refuses an unset DD_SITE rather than defaulting to US1", () => {
    const errors = configErrors({ env: { ...HEALTHY, DD_SITE: undefined } });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("DD_SITE is not set, and it has no safe default");
    expect(errors[0]).toContain("us3.datadoghq.com");
  });

  it("rejects a site that is not a Datadog site", () => {
    const errors = configErrors({ env: { ...HEALTHY, DD_SITE: "us9.datadoghq.com" } });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("DD_SITE is 'us9.datadoghq.com', which is not a Datadog site");
  });

  it("normalises a site that is upper-cased or padded", () => {
    const config = unwrap(resolveDatadogConfig({ env: { ...HEALTHY, DD_SITE: "  US3.DataDogHQ.com  " } }));
    expect(config.site).toBe("us3.datadoghq.com");
  });

  it("reports every problem at once rather than one per run", () => {
    const errors = configErrors({ env: {} });
    expect(errors).toHaveLength(3);
    expect(errors[0]).toContain("DD_API_KEY");
    expect(errors[1]).toContain("DD_APP_KEY");
    expect(errors[2]).toContain("DD_SITE");
  });
});

describe("datadogSiteState", () => {
  it("calls an addressable site set, whatever its case or padding", () => {
    expect(datadogSiteState({ raw: "us3.datadoghq.com" })).toBe("set");
    expect(datadogSiteState({ raw: "  US3.DATADOGHQ.COM " })).toBe("set");
  });

  it("calls no site, or a blank one, unset", () => {
    expect(datadogSiteState({ raw: undefined })).toBe("unset");
    expect(datadogSiteState({ raw: "   " })).toBe("unset");
  });

  it("calls a site the SDK cannot address invalid, the dead console host included", () => {
    expect(datadogSiteState({ raw: "app.datadoghq.com" })).toBe("invalid");
    expect(datadogSiteState({ raw: "nope" })).toBe("invalid");
  });
});

describe("consoleHostFor", () => {
  it("has a console host for every site the config accepts", () => {
    const hosts = DD_SITES.map((site) => consoleHostFor({ site }));
    expect(hosts.filter((host) => host.length > 0)).toHaveLength(DD_SITES.length);
  });

  it("maps the EU site onto its app. host", () => {
    expect(consoleHostFor({ site: "datadoghq.eu" })).toBe("app.datadoghq.eu");
  });

  it("leaves a region-prefixed site as its own console host", () => {
    expect(consoleHostFor({ site: "us3.datadoghq.com" })).toBe("us3.datadoghq.com");
  });
});

describe("datadogKeyPages", () => {
  it("puts a regional site's key pages on that site's own console, with no app. prefix", () => {
    expect(datadogKeyPages({ site: "ap2.datadoghq.com" })).toEqual({
      apiKeys: "https://ap2.datadoghq.com/organization-settings/api-keys",
      appKeys: "https://ap2.datadoghq.com/organization-settings/application-keys",
    });
  });

  it("puts US1's key pages on app.datadoghq.com, not the bare site", () => {
    expect(datadogKeyPages({ site: "datadoghq.com" }).apiKeys).toBe(
      "https://app.datadoghq.com/organization-settings/api-keys",
    );
  });

  it("derives every site's pages from a real console host", () => {
    expect(DD_SITES.length).toBeGreaterThan(0);
    expect(
      DD_SITES.filter(
        (site) => !isDatadogConsoleHost({ hostname: new URL(datadogKeyPages({ site }).appKeys).hostname }),
      ),
    ).toEqual([]);
  });
});

describe("isDatadogConsoleHost", () => {
  it("accepts every site's own console host, whatever its case", () => {
    expect(DD_SITES.length).toBeGreaterThan(0);
    expect(DD_SITES.filter((site) => !isDatadogConsoleHost({ hostname: consoleHostFor({ site }) }))).toEqual([]);
    expect(isDatadogConsoleHost({ hostname: "AP2.DatadogHQ.com" })).toBe(true);
  });

  it.each(["app.ap2.datadoghq.com", "docs.datadoghq.com", "api.datadoghq.com", "ap2.datadoghq.com.evil.example"])(
    "refuses %s, which is not a console",
    (hostname) => {
      expect(isDatadogConsoleHost({ hostname })).toBe(false);
    },
  );
});
