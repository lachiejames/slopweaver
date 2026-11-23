/**
 * The redaction: what a walk may store about a call the Xero client made.
 *
 * The first block is the one that matters most. A signed-in Xero session sees the organisation's whole
 * books, so a segment classifier that lets a value through puts a real identifier — or a real file name —
 * into a published generation. The Notion atlas measured that exact leak with an anchored pattern; these
 * tests are the same class caught by construction instead.
 */
import { describe, expect, it } from "vitest";

import {
  isFirstPartyXeroCall,
  reduceXeroCalls,
  XERO_SEGMENTS,
  xeroCallHost,
  xeroPathShape,
} from "../../../../atlas/xero/browserReduction.js";
import type { CapturedResponse } from "../../../../browser/pageTransport.js";

describe("isFirstPartyXeroCall", () => {
  it("accepts the web client's own origin", () => {
    expect(isFirstPartyXeroCall({ url: "https://go.xero.com/api/thing" })).toBe(true);
  });

  // Unlike its sibling atlases, one Xero page talks to several Xero hosts, so matching one origin would drop
  // most of the surface the walk exists to find.
  it("accepts another Xero host the same page also calls", () => {
    expect(isFirstPartyXeroCall({ url: "https://edge-api.xero.com/graphql" })).toBe(true);
  });

  it("accepts the bare registrable domain", () => {
    expect(isFirstPartyXeroCall({ url: "https://xero.com/thing" })).toBe(true);
  });

  it("rejects a third party whose host merely ENDS with the domain's letters", () => {
    expect(isFirstPartyXeroCall({ url: "https://notxero.com/thing" })).toBe(false);
  });

  it("rejects a third party that puts the domain in front of its own", () => {
    expect(isFirstPartyXeroCall({ url: "https://xero.com.tracker.test/beacon" })).toBe(false);
  });

  it("rejects an address it cannot read", () => {
    expect(isFirstPartyXeroCall({ url: "not a url" })).toBe(false);
  });
});

describe("XERO_SEGMENTS", () => {
  it("redacts a dashed uuid, which is Xero's identifier shape for every business object", () => {
    expect(XERO_SEGMENTS({ segment: "3b1f9e2a-4c5d-6e7f-8a9b-0c1d2e3f4a5b" })?.placeholder).toBe("{id}");
  });

  it("redacts an undashed uuid too", () => {
    expect(XERO_SEGMENTS({ segment: "3b1f9e2a4c5d6e7f8a9b0c1d2e3f4a5b" })?.placeholder).toBe("{id}");
  });

  it("redacts the organisation short code, which identifies the organisation itself", () => {
    expect(XERO_SEGMENTS({ segment: "!Ab3dE" })?.placeholder).toBe("{org}");
  });

  it("redacts a bare run of digits, which is a legacy numeric id", () => {
    expect(XERO_SEGMENTS({ segment: "1048576" })?.placeholder).toBe("{n}");
  });

  it("redacts a long opaque token", () => {
    expect(XERO_SEGMENTS({ segment: "aVeryLongOpaqueTokenValue12345" })?.placeholder).toBe("{token}");
  });

  it("leaves an ordinary route name alone, so a path shape stays readable", () => {
    expect(XERO_SEGMENTS({ segment: "BankAccounts" })).toBe(null);
  });

  it("leaves a long hyphenated route name alone rather than reading it as a token", () => {
    expect(XERO_SEGMENTS({ segment: "chart-of-accounts-and-more-detail" })).toBe(null);
  });

  it("leaves a long dotted legacy page name alone", () => {
    expect(XERO_SEGMENTS({ segment: "BankAccountsAndReconciliation.aspx" })).toBe(null);
  });
});

describe("xeroPathShape", () => {
  it("keeps the route and redacts the identifier inside it", () => {
    expect(
      xeroPathShape({ url: "https://api.xero.com/api.xro/2.0/Invoices/3b1f9e2a-4c5d-6e7f-8a9b-0c1d2e3f4a5b" }),
    ).toBe("/api.xro/2.0/Invoices/{id}");
  });

  it("redacts the organisation out of an app route", () => {
    expect(xeroPathShape({ url: "https://go.xero.com/app/!Ab3dE/dashboard" })).toBe("/app/{org}/dashboard");
  });

  it("answers null for an address it cannot read", () => {
    expect(xeroPathShape({ url: "::::" })).toBe(null);
  });
});

describe("xeroCallHost", () => {
  it("lower-cases the host, because the host is half the identity a channel is matched on", () => {
    expect(xeroCallHost({ url: "https://API.Xero.com/api.xro/2.0/Invoices" })).toBe("api.xero.com");
  });
});

/** One captured response, with only the fields a reduction reads stated. */
function response({ over }: { over: Partial<CapturedResponse> }): CapturedResponse {
  return { body: {}, method: "GET", statusCode: 200, url: "https://api.xero.com/api.xro/2.0/Invoices", ...over };
}

describe("reduceXeroCalls", () => {
  it("keeps a first-party call", () => {
    expect(reduceXeroCalls({ responses: [response({ over: {} })] })).toHaveLength(1);
  });

  it("drops third-party telemetry at extraction rather than filtering it later", () => {
    expect(reduceXeroCalls({ responses: [response({ over: { url: "https://analytics.test/beacon" } })] })).toEqual([]);
  });

  // Field PATHS, two levels deep, and every leaf is a name. The values in this body — an amount and an
  // invoice number — appear nowhere in what is stored, which is the whole property.
  it("records the field NAMES a response carried and never a value", () => {
    const rows = reduceXeroCalls({
      responses: [response({ over: { body: { Invoices: [{ AmountDue: 1234.56, InvoiceNumber: "INV-0007" }] } } })],
    });
    expect(rows[0]!.responseFields).toEqual(["Invoices", "Invoices[].AmountDue", "Invoices[].InvoiceNumber"]);
  });

  it("stores no value from a response body at all", () => {
    const responses = [response({ over: { body: { Invoices: [{ AmountDue: 1234.56, InvoiceNumber: "INV-0007" }] } } })];
    const rows = reduceXeroCalls({ responses });
    // Both halves, per `.claude/rules/testing.md`'s falsifiable-witness rule.
    expect(JSON.stringify(responses)).toContain("INV-0007");
    expect(rows[0]!.responseFields.join(" ")).not.toContain("INV-0007");
  });

  it("carries the host, because Xero spreads one page's calls over several", () => {
    const rows = reduceXeroCalls({ responses: [response({ over: { url: "https://edge-api.xero.com/graphql" } })] });
    expect(rows[0]!.host).toBe("edge-api.xero.com");
  });

  it("carries the status the call answered", () => {
    const rows = reduceXeroCalls({ responses: [response({ over: { statusCode: 403 } })] });
    expect(rows[0]!.statusCode).toBe(403);
  });

  it("orders rows by host then path, so a published file is stable", () => {
    const rows = reduceXeroCalls({
      responses: [
        response({ over: { url: "https://go.xero.com/b" } }),
        response({ over: { url: "https://api.xero.com/a" } }),
      ],
    });
    expect(rows.map((row) => `${row.host}${row.pathShape}`)).toEqual(["api.xero.com/a", "go.xero.com/b"]);
  });
});
