/**
 * The Datadog console seam's halves that need no browser: what the two snippet builders produce, and what
 * each snippet's own JSON becomes.
 *
 * Both arms act in the owner's browser — one hovers, one presses a key chord — so the property worth proving
 * here is the one that bounds them: a caller supplies three values and never source, the nav lists and the
 * chord are constants, and a palette body from off the lease is dropped exactly as a page visit drops one.
 * Every Datadog host in this file reads a synthetic site rather than the install's own.
 */
import { describe, expect, it } from "vitest";

import { err, ok, type Result, unwrap, unwrapErr } from "#lib/result.js";
import { navObservationFrom, paletteObservationFrom } from "../../../browser/datadogConsole.js";
import {
  DATADOG_NAV_LIST_LABELS,
  DATADOG_PALETTE_KEY,
  datadogNavObserveSnippet,
  datadogPaletteObserveSnippet,
} from "../../../browser/datadogConsoleSnippet.js";
import { type BrowserTransportError, BrowserTransportErrors } from "../../../browser/pageTransport.js";
import { relayOperationSnippet } from "../../../browser/relayDispatch.js";
import type { RelayLease } from "../../../browser/relayLease.js";

const SHOT = "/x/palette.png";
const URL = "https://ap1.datadoghq.invalid/";
const LEASE: RelayLease = { origins: ["https://ap1.datadoghq.invalid"], platform: "datadog", release: () => {} };

/** What the terminal client prints for one operation: an envelope whose `result` is the snippet's JSON. */
function printed(snippet: Record<string, unknown>): Result<string, BrowserTransportError> {
  return ok(JSON.stringify({ result: JSON.stringify(snippet) }));
}

describe("the nav snippet", () => {
  const source = datadogNavObserveSnippet({ settleMs: 10, url: URL });

  it("bakes the URL and the settle time in as JSON literals", () => {
    expect(source).toContain(JSON.stringify(URL));
    expect(source).toContain("await page.waitForTimeout(10)");
  });

  it("hovers the nav's own lists by their fixed accessible labels, and clicks nothing", () => {
    expect(source).toContain(JSON.stringify(DATADOG_NAV_LIST_LABELS));
    expect(source).toContain('nav[aria-label="Main"]');
    expect(source).toContain("page.hover(");
    expect(source).not.toContain("page.click(");
    expect(source).not.toContain("keyboard.press");
  });

  it("is what the relay dispatches for the datadog-nav-observe arm", () => {
    expect(relayOperationSnippet({ operation: { kind: "datadog-nav-observe", settleMs: 10, url: URL } })).toBe(source);
  });
});

describe("the palette snippet", () => {
  const source = datadogPaletteObserveSnippet({ screenshotPath: SHOT, settleMs: 10, url: URL });

  it("presses exactly the fixed chord, then Escape, and types nothing", () => {
    expect(DATADOG_PALETTE_KEY).toBe("Meta+k");
    expect(source).toContain(`page.keyboard.press(${JSON.stringify(DATADOG_PALETTE_KEY)})`);
    expect(source).toContain('page.keyboard.press("Escape")');
    expect(source).not.toContain("keyboard.type");
    expect(source).not.toContain("page.click(");
  });

  it("installs the shared response hook before navigating and drains the page's own traffic first", () => {
    expect(source.indexOf('page.on("response"')).toBeLessThan(source.indexOf("page.goto("));
    expect(source).toContain("responses.splice(0, responses.length)");
  });

  it("is what the relay dispatches for the datadog-palette-observe arm", () => {
    const dispatched = relayOperationSnippet({
      operation: { kind: "datadog-palette-observe", screenshotPath: SHOT, settleMs: 10, url: URL },
    });
    expect(dispatched).toBe(source);
  });
});

describe("navObservationFrom", () => {
  it("flattens the sections the snippet read into links carrying their section, and lists what was hovered", () => {
    const observation = unwrap(
      navObservationFrom({
        result: printed({
          finalUrl: URL,
          hoverErrors: [],
          sections: [
            {
              links: [
                { href: "/ask", label: "Bits AI" },
                { href: "/ask/usage", label: "Reports" },
              ],
              section: "Bits AI",
            },
            { links: [{ href: "/help", label: "Help" }], section: "Help" },
          ],
          title: "Datadog",
        }),
      }),
    );

    expect(observation.sections).toStrictEqual(["Bits AI", "Help"]);
    expect(observation.links).toStrictEqual([
      { href: "/ask", label: "Bits AI", section: "Bits AI" },
      { href: "/ask/usage", label: "Reports", section: "Bits AI" },
      { href: "/help", label: "Help", section: "Help" },
    ]);
    expect(observation.hoverErrors).toStrictEqual([]);
  });

  it("carries a hover that failed as a named error rather than as an empty section", () => {
    const observation = unwrap(
      navObservationFrom({
        result: printed({ finalUrl: URL, hoverErrors: ["li:nth-child(3): timeout"], sections: [], title: "" }),
      }),
    );
    expect(observation.hoverErrors).toStrictEqual(["li:nth-child(3): timeout"]);
    expect(observation.sections).toStrictEqual([]);
  });

  it("turns a navigation failure the snippet reported into the typed transport error", () => {
    const failed = unwrapErr(navObservationFrom({ result: printed({ failure: "net::ERR", finalUrl: URL }) }));
    expect(failed.code).toBe("NAVIGATION_FAILED");
  });

  it("passes a transport failure through untouched", () => {
    const lost = BrowserTransportErrors.sessionLost({ reason: "gone" });
    expect(unwrapErr(navObservationFrom({ result: err(lost) }))).toBe(lost);
  });

  it("reports an unparseable print as a lost session, not as an empty nav", () => {
    expect(unwrapErr(navObservationFrom({ result: ok("not json") })).code).toBe("SESSION_LOST");
  });
});

describe("paletteObservationFrom", () => {
  const body = { entities: [{ type: "dashboard" }] };
  const snippet = {
    accounting: { bodyFailed: 0, bodySucceeded: 2, eligible: 2, seen: 5 },
    finalUrl: URL,
    keyError: null,
    palette: { dialogOpen: true, filterNames: ["Dashboard", "Monitor"], optionCount: 24 },
    responses: [
      {
        body,
        method: "POST",
        statusCode: 200,
        url: "https://ap1.datadoghq.invalid/api/ui/search/suggestions/entities",
      },
      { body: {}, method: "GET", statusCode: 200, url: "https://elsewhere.invalid/api/x" },
    ],
    screenshotError: null,
    screenshotWritten: true,
    title: "Datadog",
  };

  it("keeps the palette's own calls on the lease and drops the foreign one from the accounting too", () => {
    const observation = unwrap(
      paletteObservationFrom({ lease: LEASE, result: printed(snippet), screenshotPath: SHOT }),
    );

    expect(observation.dialogOpen).toBe(true);
    expect(observation.filterNames).toStrictEqual(["Dashboard", "Monitor"]);
    expect(observation.optionCount).toBe(24);
    expect(observation.responses.map((response) => response.url)).toStrictEqual([
      "https://ap1.datadoghq.invalid/api/ui/search/suggestions/entities",
    ]);
    expect(observation.responseAccounting).toStrictEqual({ bodyFailed: 0, bodySucceeded: 1, eligible: 1, seen: 5 });
    expect(observation.screenshotPath).toBe(SHOT);
  });

  it("keeps no body at all before a lease exists, because nothing binds them to an origin", () => {
    const observation = unwrap(paletteObservationFrom({ lease: null, result: printed(snippet), screenshotPath: SHOT }));
    expect(observation.responses).toStrictEqual([]);
  });

  it("reports a palette that never opened as dialogOpen false with the chord's error beside it", () => {
    const observation = unwrap(
      paletteObservationFrom({
        lease: LEASE,
        result: printed({
          ...snippet,
          keyError: "no keyboard",
          palette: { dialogOpen: false, filterNames: [], optionCount: 0 },
          screenshotWritten: false,
        }),
        screenshotPath: SHOT,
      }),
    );
    expect(observation.dialogOpen).toBe(false);
    expect(observation.keyError).toBe("no keyboard");
    expect(observation.screenshotPath).toBe(null);
  });
});
