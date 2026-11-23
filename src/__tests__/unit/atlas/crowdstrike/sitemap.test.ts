import { describe, expect, it } from "vitest";

import { canonicaliseFalconHref, parseFalconSitemap } from "../../../../atlas/crowdstrike/sitemap.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const ORIGIN = "https://falcon.example-cloud.test";

/**
 * The nesting the console actually publishes — groups holding sections holding links, with `checks`
 * carrying feature flags and a permissions OBJECT. Values are synthetic: a vendor's real module and
 * permission names are generation content and never belong in a committed fixture.
 */
const SITEMAP = [
  {
    csSelector: "modules",
    groups: [
      {
        label: "main-view",
        sections: [
          {
            appName: "example-hub",
            checks: { featureFlags: ["ui-example-hub"] },
            links: [{ href: "/hub/summary", label: "summary" }],
          },
          {
            appName: "example-assistant",
            links: [
              {
                checks: {
                  featureFlags: ["ui-assistant", "ui-assistant-chat"],
                  permissions: { "csrn:example:conversation": ["read"] },
                },
                href: "/assistant",
              },
              { href: "/assistant/audit" },
            ],
          },
        ],
      },
    ],
  },
];

describe("canonicaliseFalconHref", () => {
  it("keeps a same-origin path", () => {
    expect(canonicaliseFalconHref({ href: "/hub/summary", origin: ORIGIN })).toBe("/hub/summary");
  });

  it("drops a fragment, because it is a position on a page rather than a page", () => {
    expect(canonicaliseFalconHref({ href: "/hosts#tab-two", origin: ORIGIN })).toBe("/hosts");
  });

  it("sorts a query so two orderings are one destination", () => {
    const a = canonicaliseFalconHref({ href: "/assets?view=all&sort=name", origin: ORIGIN });
    const b = canonicaliseFalconHref({ href: "/assets?sort=name&view=all", origin: ORIGIN });
    expect(a).toBe("/assets?sort=name&view=all");
    expect(b).toBe(a);
  });

  it("rejects an off-origin href", () => {
    expect(canonicaliseFalconHref({ href: "https://elsewhere.test/docs", origin: ORIGIN })).toBe(null);
  });

  it("rejects an unparseable href", () => {
    expect(canonicaliseFalconHref({ href: "http://[bad", origin: ORIGIN })).toBe(null);
  });
});

describe("parseFalconSitemap", () => {
  it("finds every declared route however deeply it is nested", () => {
    const sitemap = unwrap(parseFalconSitemap({ json: SITEMAP, origin: ORIGIN }));
    expect(sitemap.routes.map((route) => route.href)).toEqual(["/assistant", "/assistant/audit", "/hub/summary"]);
  });

  it("keeps the gates the console declares, so an unopenable page is explicable", () => {
    const sitemap = unwrap(parseFalconSitemap({ json: SITEMAP, origin: ORIGIN }));
    const assistant = sitemap.routes.find((route) => route.href === "/assistant")!;
    expect(assistant.featureFlags).toEqual(["ui-assistant", "ui-assistant-chat"]);
    expect(assistant.permissions).toEqual(["csrn:example:conversation"]);
  });

  it("carries the owning app when the console declares one", () => {
    const sitemap = unwrap(parseFalconSitemap({ json: SITEMAP, origin: ORIGIN }));
    expect(sitemap.routes.find((route) => route.href === "/hub/summary")!.appName).toBe("example-hub");
  });

  it("inherits the owning app from the section, which is where the console declares it", () => {
    const sitemap = unwrap(parseFalconSitemap({ json: SITEMAP, origin: ORIGIN }));
    const audit = sitemap.routes.find((route) => route.href === "/assistant/audit")!;
    expect(audit.appName).toBe("example-assistant");
    expect(audit.featureFlags).toEqual([]);
    expect(audit.permissions).toEqual([]);
  });

  it("adds a section's gates to its links' own, rather than replacing either", () => {
    const json = [
      {
        appName: "example-section",
        checks: { featureFlags: ["section-flag"], permissions: { "csrn:example:section": ["read"] } },
        links: [
          {
            checks: { featureFlags: ["link-flag"], permissions: { "csrn:example:link": ["read"] } },
            href: "/gated",
          },
        ],
      },
    ];
    const route = unwrap(parseFalconSitemap({ json, origin: ORIGIN })).routes[0]!;
    expect(route.featureFlags).toEqual(["link-flag", "section-flag"]);
    expect(route.permissions).toEqual(["csrn:example:link", "csrn:example:section"]);
    expect(route.appName).toBe("example-section");
  });

  it("lets a nested app name override the one above it", () => {
    const json = [{ appName: "outer", links: [{ appName: "inner", href: "/nested" }] }];
    const route = unwrap(parseFalconSitemap({ json, origin: ORIGIN })).routes[0]!;
    expect(route.appName).toBe("inner");
  });

  it("collapses a duplicated href to one route and names the duplicate", () => {
    const json = [{ links: [{ href: "/hosts" }, { href: "/hosts#anchor" }] }];
    const sitemap = unwrap(parseFalconSitemap({ json, origin: ORIGIN }));
    expect(sitemap.routes.map((route) => route.href)).toEqual(["/hosts"]);
    expect(sitemap.duplicateHrefs).toEqual(["/hosts"]);
  });

  it("counts off-origin declarations instead of walking them", () => {
    const json = [{ links: [{ href: "/hosts" }, { href: "https://docs.elsewhere.test/a" }] }];
    const sitemap = unwrap(parseFalconSitemap({ json, origin: ORIGIN }));
    expect(sitemap.externalCount).toBe(1);
    expect(sitemap.routes.map((route) => route.href)).toEqual(["/hosts"]);
  });

  it("REFUSES a document declaring no href, rather than reporting full coverage over nothing", () => {
    const problems = unwrapErr(parseFalconSitemap({ json: { modules: [] }, origin: ORIGIN }));
    expect(problems[0]).toContain("declared no href at all");
  });

  it("refuses an origin that is not a URL", () => {
    const problems = unwrapErr(parseFalconSitemap({ json: SITEMAP, origin: "not-a-url" }));
    expect(problems[0]).toContain("sitemap origin is not a URL");
  });

  it("returns routes in a stable order regardless of declaration order", () => {
    const reversed = [{ links: [{ href: "/hub/summary" }, { href: "/assistant" }] }];
    const sitemap = unwrap(parseFalconSitemap({ json: reversed, origin: ORIGIN }));
    expect(sitemap.routes.map((route) => route.href)).toEqual(["/assistant", "/hub/summary"]);
  });
});

describe("parseFalconSitemap's refusals, line for line", () => {
  it("refuses an origin that is not a URL with exactly one line quoting it", () => {
    expect(unwrapErr(parseFalconSitemap({ json: SITEMAP, origin: "not a url" }))).toEqual([
      "sitemap origin is not a URL: not a url",
    ]);
  });

  it("refuses a document declaring no href with exactly one line", () => {
    expect(unwrapErr(parseFalconSitemap({ json: {}, origin: ORIGIN }))).toEqual([
      "the Falcon sitemap declared no href at all — the document shape has changed, and walking zero pages would report full coverage over nothing",
    ]);
  });
});
