import { describe, expect, it } from "vitest";

import {
  brazeFamilyOf,
  brazeOperationPages,
  isBrazeOperationPage,
  readBrazeOperationPage,
  readBrazeSitemap,
} from "../../../../atlas/braze/docsCatalogue.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://www.braze.com/docs/api/endpoints/export/campaigns/get_campaign_analytics</loc><lastmod>2026-08-01T00:00:00+00:00</lastmod></url>
  <url><loc>https://www.braze.com/docs/api/endpoints/export</loc><lastmod>2026-08-02T00:00:00+00:00</lastmod></url>
  <url><loc>https://www.braze.com/docs/api/basics</loc><lastmod>2026-08-03T00:00:00+00:00</lastmod></url>
  <url><loc>https://www.braze.com/docs/user_guide/administer</loc><lastmod>2026-08-04T00:00:00+00:00</lastmod></url>
  <url><loc>https://www.braze.com/docs/api/endpoints/user_data/post_user_track</loc></url>
</urlset>`;

/** The shape Braze server-renders into every endpoint page, entity-encoded exactly as it arrives. */
const PAGE = `<html><head><meta content="&lt;h1 id=&quot;x&quot;&gt;ignored&lt;/h1&gt;"></head><body>
<h1 id="export-campaign-analytics">Export campaign analytics</h1>
<div class="api_type"><div class="method get ">get</div> <p>/campaigns/data_series</p> </div>
<h2 id="rate-limit">Rate limit</h2><p>250,000 requests per hour.</p>
<h2 id="request-parameters">Request parameters</h2>
<table aria-label="Request parameters"><thead><tr><th>Parameter</th></tr></thead><tbody>
<tr><td><code>campaign_id</code></td><td>Required</td><td>String</td><td>the campaign</td></tr>
<tr><td><code>length</code></td><td>Optional</td><td>Integer</td><td>days</td></tr>
</tbody></table>
<h2 id="response">Response</h2><pre><code>{ "message": "success", "data": [ { "time": "2026-01-01" } ] }</code></pre>
<h2 id="troubleshooting">Troubleshooting</h2><pre><code>{ "never_read": 1 }</code></pre>
</body></html>`;

describe("readBrazeSitemap", () => {
  it("keeps only entries carrying both a location and a modification instant", () => {
    const entries = readBrazeSitemap({ xml: SITEMAP });
    expect(entries.length).toBe(4);
    expect(entries[0]?.url).toBe("https://www.braze.com/docs/api/endpoints/export/campaigns/get_campaign_analytics");
    expect(entries[0]?.lastModified).toBe("2026-08-01T00:00:00+00:00");
  });

  it("reads nothing from a document with no url blocks", () => {
    expect(readBrazeSitemap({ xml: "<urlset></urlset>" }).length).toBe(0);
  });
});

describe("brazeOperationPages", () => {
  it("keeps the pages whose last segment begins with a method, and drops family indexes", () => {
    const pages = brazeOperationPages({ entries: readBrazeSitemap({ xml: SITEMAP }) });
    expect(pages.length).toBe(1);
    expect(pages[0]?.url).toBe("https://www.braze.com/docs/api/endpoints/export/campaigns/get_campaign_analytics");
  });
});

describe("isBrazeOperationPage", () => {
  it("accepts an address under the endpoints tree whose last segment begins with a method", () => {
    expect(
      isBrazeOperationPage({ url: "https://www.braze.com/docs/api/endpoints/user_data/get_users_track_status" }),
    ).toBe(true);
  });

  it("accepts the same address with a trailing slash", () => {
    expect(isBrazeOperationPage({ url: "https://www.braze.com/docs/api/endpoints/user_data/post_user_track/" })).toBe(
      true,
    );
  });

  it("refuses a family index — where an unserved page settled", () => {
    expect(isBrazeOperationPage({ url: "https://www.braze.com/docs/api/endpoints/user_data" })).toBe(false);
  });

  it("judges the path alone, so a query string ending in an operation slug does not make a family index one", () => {
    expect(isBrazeOperationPage({ url: "https://www.braze.com/docs/api/endpoints/user_data?next=/get_fake" })).toBe(
      false,
    );
  });

  it("refuses an operation-shaped path on any host but Braze's own docs host", () => {
    expect(isBrazeOperationPage({ url: "https://elsewhere.example/docs/api/endpoints/user_data/get_impostor" })).toBe(
      false,
    );
  });

  it("judges a percent-encoded address by the operation it decodes to", () => {
    expect(isBrazeOperationPage({ url: "https://www.braze.com/docs/api/endpoints/user_data/%67et_problem" })).toBe(
      true,
    );
  });

  // `%2F` is part of its segment, not a separator: decoding the whole path would turn this family-level
  // `not_an_operation%2Fget_fake` segment into an invented `get_fake` operation.
  it("refuses an address whose encoded slash would invent an operation segment", () => {
    expect(
      isBrazeOperationPage({ url: "https://www.braze.com/docs/api/endpoints/user_data/not_an_operation%2Fget_fake" }),
    ).toBe(false);
  });

  it("refuses an address whose path will not decode", () => {
    expect(isBrazeOperationPage({ url: "https://www.braze.com/docs/api/endpoints/user_data/get_%E0%A4%A" })).toBe(
      false,
    );
  });

  it("refuses a page outside the endpoints tree", () => {
    expect(isBrazeOperationPage({ url: "https://www.braze.com/docs/api/basics" })).toBe(false);
  });
});

describe("brazeFamilyOf", () => {
  it("reads Braze's own first segment under the endpoints tree", () => {
    expect(brazeFamilyOf({ url: "https://www.braze.com/docs/api/endpoints/export/campaigns/get_x" })).toBe("export");
  });

  it("answers null for a page outside the endpoints tree", () => {
    expect(brazeFamilyOf({ url: "https://www.braze.com/docs/user_guide/administer" })).toBe(null);
  });
});

describe("readBrazeOperationPage", () => {
  const read = () =>
    readBrazeOperationPage({
      html: PAGE,
      kind: "export",
      lastModified: "2026-08-01T00:00:00+00:00",
      url: "https://www.braze.com/docs/api/endpoints/export/campaigns/get_campaign_analytics",
    });

  it("reads the method and address out of Braze's own declaration block", () => {
    const row = unwrap(read());
    expect(row.method).toBe("GET");
    expect(row.pathShape).toBe("/campaigns/data_series");
    expect(row.providerId).toBe("GET /campaigns/data_series");
  });

  it("takes the title from the page's own heading rather than the meta copy", () => {
    expect(unwrap(read()).title).toBe("Export campaign analytics");
  });

  it("reads the request-parameter table, including which are required", () => {
    const row = unwrap(read());
    expect(row.parameters).toEqual([
      { name: "campaign_id", required: true, type: "String" },
      { name: "length", required: false, type: "Integer" },
    ]);
  });

  it("reads response field NAMES from the response section and never from a later section", () => {
    expect(unwrap(read()).responseFields).toEqual(["data", "message", "time"]);
  });

  it("keeps the stated rate limit", () => {
    expect(unwrap(read()).rateLimit).toBe("250,000 requests per hour.");
  });

  it("classes the operation as it reads it", () => {
    const row = unwrap(read());
    expect(row.disposition).toBe("voluminous");
    expect(row.dispositionRuleId).toBe("voluminous-analytics-series");
  });

  it("finds no address defect in an ordinary page", () => {
    expect(unwrap(read()).pathDefect).toBe(null);
  });

  it("refuses a page carrying no declaration block rather than dropping the operation", () => {
    const result = readBrazeOperationPage({
      html: "<html><body><h1>Nothing here</h1></body></html>",
      kind: "export",
      lastModified: "2026-08-01T00:00:00+00:00",
      url: "https://www.braze.com/docs/api/endpoints/export/campaigns/get_x",
    });
    expect(unwrapErr(result)).toEqual([
      'https://www.braze.com/docs/api/endpoints/export/campaigns/get_x carries no <div class="api_type"> block, ' +
        "so this build cannot read the method and address Braze declares for it",
      "every operation page Braze served at its own address carried one when this reader was measured (146 of 146, " +
        "on two separate measurements), and a page redirected off the operation tree is reported as unserved " +
        "before this check — so a page served as an operation without one is a change in Braze's own template " +
        "rather than an operation to drop silently",
    ]);
  });

  it("records a query string in the declaration block as a defect rather than repairing it", () => {
    const scim = `<h1>Look up</h1><div class="api_type"><div class="method get ">get</div> <p>scim/v2/Users?filter=userName eq "x"</p></div>`;
    const row = unwrap(
      readBrazeOperationPage({
        html: scim,
        kind: "scim",
        lastModified: "2026-08-01T00:00:00+00:00",
        url: "https://www.braze.com/docs/api/endpoints/scim/get_x",
      }),
    );
    expect(row.pathShape).toBe('scim/v2/Users?filter=userName eq "x"');
    expect(row.providerId).toBe("GET /scim/v2/Users");
    expect(row.pathDefect).toBe(
      "carries a query string in the block that is supposed to declare the endpoint address alone",
    );
  });

  it("reads a page that declares no parameters, rate limit or response as having none", () => {
    const bare = `<h1>Bare</h1><div class="api_type"><div class="method post ">post</div> <p>/users/track</p></div>`;
    const row = unwrap(
      readBrazeOperationPage({
        html: bare,
        kind: "user_data",
        lastModified: "2026-08-01T00:00:00+00:00",
        url: "https://www.braze.com/docs/api/endpoints/user_data/post_user_track",
      }),
    );
    expect(row.parameters).toEqual([]);
    expect(row.responseFields).toEqual([]);
    expect(row.rateLimit).toBe(null);
  });
});

describe("tag stripping, which CodeQL caught being incomplete", () => {
  /** Read one parameter table through the real page reader, since stripTags is not exported. */
  const parametersFrom = ({ cell }: { cell: string }) =>
    unwrap(
      readBrazeOperationPage({
        html:
          `<h1>T</h1><div class="api_type"><div class="method get ">get</div> <p>/x</p></div>` +
          `<h2 id="request-parameters">Request parameters</h2>` +
          `<table aria-label="Request parameters"><tbody><tr><td>${cell}</td><td>Required</td><td>String</td><td>d</td></tr></tbody></table>`,
        kind: "export",
        lastModified: "2026-08-01T00:00:00+00:00",
        url: "https://www.braze.com/docs/api/endpoints/export/get_x",
      }),
    ).parameters;

  it("leaves nothing behind when an attribute value contains a tag-like string", () => {
    expect(parametersFrom({ cell: '<code title="<b>">campaign_id</code>' })).toEqual([
      { name: "campaign_id", required: true, type: "String" },
    ]);
  });

  it("strips an unterminated tag rather than emitting its text", () => {
    expect(parametersFrom({ cell: "<code>length<span</code>" })).toEqual([
      { name: "length", required: true, type: "String" },
    ]);
  });

  // A literal `>` rather than an entity: the reader prefers Braze's RAW body markup, so what reaches
  // stripTags is whatever the page literally holds. MEASURED on the real generation: zero
  // extracted values carry an undecoded HTML entity, so no decode pass is warranted for text content.
  it("keeps a greater-than that is prose rather than markup", () => {
    expect(parametersFrom({ cell: "<code>a > b</code>" })).toEqual([{ name: "a > b", required: true, type: "String" }]);
  });
});
