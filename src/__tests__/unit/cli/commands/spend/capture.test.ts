import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  type BrowserPageTransport,
  BrowserTransportErrors,
  type CapturedResponse,
  type PageCapture,
} from "../../../../../browser/pageTransport.js";
import {
  runSpendCapture,
  type SpendCaptureDeps,
  settledElsewhere,
  visitFailureLine,
} from "../../../../../cli/commands/spend/capture.js";
import { parseSpendCaptureArgs } from "../../../../../cli/commands/spend/captureArgs.js";
import { ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { readLatestSnapshots, writeCardSnapshot } from "../../../../../spend/store.js";
import { calibration, details, limits, REASON, row, transactions } from "../../../spend/liveFixture.js";

const CARD_PAGE = "https://www.airwallex.com/app/cards/cardholder/card-id?cardAccountId=account-id&view=expanded";

/** A capture that settled at `finalUrl` and heard the responses given, one shape-only card response by default. */
const capture = ({
  finalUrl,
  responses = [
    {
      body: { monthlyLimit: { amount: 2500, used: 2410.58 } },
      method: "GET",
      statusCode: 200,
      url: "https://www.airwallex.com/api/v1/cards/card-id/limits?x=1",
    },
  ],
}: {
  finalUrl: string;
  responses?: readonly CapturedResponse[];
}): PageCapture => ({
  finalUrl,
  links: [],
  linksBlockedBecause: null,
  observedAt: "2026-09-29T10:35:00.000Z",
  requestedUrl: CARD_PAGE,
  responseAccounting: { bodyFailed: 0, bodySucceeded: 1, eligible: 1, seen: 12 },
  responses,
  screenshotBlockedBecause: null,
  screenshotPng: null,
  statusCode: 200,
  title: "Airwallex",
});

/** Edges over a fake transport that records what it was asked, and the lines each stream received. */
const harness = ({ finalUrl, responses }: { finalUrl: string; responses?: readonly CapturedResponse[] }) => {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const visits: { url: string; photograph: boolean | undefined }[] = [];
  let released = 0;
  const transport: BrowserPageTransport = {
    release: async () => {
      released += 1;
      return ok(null);
    },
    visit: async ({ url, photograph }) => {
      visits.push({ photograph, url });
      if (responses === undefined) {
        return ok(capture({ finalUrl }));
      }
      return ok(capture({ finalUrl, responses }));
    },
  };
  const deps: SpendCaptureDeps = {
    attach: async () => ok(transport),
    defaultHome: () => "/unused-home",
    now: () => "2026-09-29T10:35:00.000Z",
    readFile: () => "",
    timeZone: () => "Australia/Sydney",
    writeDiagnostic: (line) => {
      diagnostics.push(line);
    },
    writeOut: (line) => {
      out.push(line);
    },
  };
  return { deps, diagnostics, out, released: () => released, visits };
};

describe("parseSpendCaptureArgs", () => {
  it("reads the card page and the switches", () => {
    expect(unwrap(parseSpendCaptureArgs({ rest: ["--url", CARD_PAGE, "--discover", "--json"] }))).toEqual({
      home: undefined,
      json: true,
      mode: { kind: "discover" },
      url: CARD_PAGE,
    });
  });

  it("refuses a page off the Airwallex origin before anything opens", () => {
    expect(unwrapErr(parseSpendCaptureArgs({ rest: ["--url", "https://example.com/card", "--discover"] }))).toEqual({
      code: "CAPTURE_URL_OFF_ORIGIN",
      message:
        "--url must be on https://www.airwallex.com — the only origin a capture may address, got https://example.com",
      origin: "https://example.com",
    });
  });

  it("reads a store with the card's last four digits", () => {
    expect(unwrap(parseSpendCaptureArgs({ rest: ["--url", CARD_PAGE, "--store", "--last4", "0042"] })).mode).toEqual({
      kind: "store",
      last4: "0042",
    });
  });

  it("refuses a capture with neither mode, or both", () => {
    expect(unwrapErr(parseSpendCaptureArgs({ rest: ["--url", CARD_PAGE] })).code).toBe("CAPTURE_MODE_INVALID");
    expect(
      unwrapErr(parseSpendCaptureArgs({ rest: ["--url", CARD_PAGE, "--discover", "--store", "--last4", "0042"] })).code,
    ).toBe("CAPTURE_MODE_INVALID");
  });

  it("refuses a store without four digits, and --last4 on a discovery", () => {
    expect(unwrapErr(parseSpendCaptureArgs({ rest: ["--url", CARD_PAGE, "--store"] })).code).toBe(
      "CAPTURE_LAST4_INVALID",
    );
    expect(unwrapErr(parseSpendCaptureArgs({ rest: ["--url", CARD_PAGE, "--store", "--last4", "42"] })).code).toBe(
      "CAPTURE_LAST4_INVALID",
    );
    expect(unwrapErr(parseSpendCaptureArgs({ rest: ["--url", CARD_PAGE, "--discover", "--last4", "0042"] })).code).toBe(
      "CAPTURE_LAST4_INVALID",
    );
  });

  it("refuses a missing --url", () => {
    expect(unwrapErr(parseSpendCaptureArgs({ rest: ["--discover"] })).code).toBe("CAPTURE_URL_MISSING");
  });

  it("refuses a relative --url without echoing it", () => {
    expect(unwrapErr(parseSpendCaptureArgs({ rest: ["--url", "/app/cards/card-id", "--discover"] }))).toEqual({
      code: "CAPTURE_URL_NOT_ABSOLUTE",
      message: "--url must be an absolute https://www.airwallex.com address",
    });
  });

  it("never echoes a card page passed without --url, which the flag parser would quote whole", () => {
    const refusal = unwrapErr(parseSpendCaptureArgs({ rest: [CARD_PAGE, "--discover"] }));
    expect(refusal.code).toBe("CAPTURE_FLAGS_INVALID");
    expect(refusal.message).toContain("<argument>");
    expect(refusal.message).not.toContain("card-id");
    expect(refusal.message).not.toContain("account-id");
  });

  it("carries the flag parser's own problems through", () => {
    expect(unwrapErr(parseSpendCaptureArgs({ rest: ["--url", CARD_PAGE, "--discover", "--bogus"] })).code).toBe(
      "CAPTURE_FLAGS_INVALID",
    );
  });
});

describe("settledElsewhere", () => {
  it("is null when the page settled on the card page, whatever its query", () => {
    expect(
      settledElsewhere({ finalUrl: "https://www.airwallex.com/app/cards/cardholder/card-id", requestedUrl: CARD_PAGE }),
    ).toBe(null);
  });

  it("names a sign-in redirect as signed out, not as an empty backend", () => {
    expect(settledElsewhere({ finalUrl: "https://www.airwallex.com/app/login", requestedUrl: CARD_PAGE })).toBe(
      "the card page redirected to /app/login: Airwallex is signed out in their work Chrome, so nothing was read. " +
        "They sign in there once, then run this again",
    );
  });
});

describe("visitFailureLine", () => {
  it("prints a navigation failure's reason and never the address it was given", () => {
    const line = visitFailureLine({
      error: BrowserTransportErrors.navigationFailed({
        because: "the page did not settle inside the bound",
        reason: "page.goto: Timeout 45000ms exceeded",
        url: CARD_PAGE,
      }),
    });
    expect(line).toBe("NAVIGATION_FAILED — the page did not settle inside the bound");
    expect(CARD_PAGE).toContain("account-id");
    expect(line).not.toContain("account-id");
  });

  it("prints an off-origin settle without the foreign address", () => {
    expect(
      visitFailureLine({
        error: BrowserTransportErrors.offLeaseOrigin({ reason: "settled elsewhere", url: "https://sso.example/x?t=1" }),
      }),
    ).toBe("OFF_LEASE_ORIGIN — the page left https://www.airwallex.com, so nothing it heard is kept");
  });
});

describe("runSpendCapture", () => {
  it("visits without a picture, releases the tab, and prints shape with no value", async () => {
    const run = harness({ finalUrl: "https://www.airwallex.com/app/cards/cardholder/card-id" });
    expect(await runSpendCapture({ deps: run.deps, rest: ["--url", CARD_PAGE, "--discover"] })).toBe(0);
    expect(run.visits).toEqual([{ photograph: false, url: CARD_PAGE }]);
    expect(run.released()).toBe(1);
    expect(run.out).toEqual([
      "spend capture --discover: settled on /app/cards/cardholder/card-id; 12 response(s) seen, 1 JSON on " +
        "https://www.airwallex.com, 1 read, 0 unreadable",
      "GET /api/v1/cards/card-id/limits → 200, 3 field(s)\n    monthlyLimit: object\n    monthlyLimit.amount: number\n" +
        "    monthlyLimit.used: number",
    ]);
    expect(run.out.join("\n")).not.toContain("2410");
  });

  it("exits 1 on a sign-in redirect and prints no report", async () => {
    const run = harness({ finalUrl: "https://www.airwallex.com/app/login" });
    expect(await runSpendCapture({ deps: run.deps, rest: ["--url", CARD_PAGE, "--discover"] })).toBe(1);
    expect(run.out).toEqual([]);
    expect(run.diagnostics[0]).toContain("Airwallex is signed out in their work Chrome");
  });

  it("stores a calibrated live snapshot beside the pasted one and prints no value off the page", async () => {
    const home = mkdtempSync(join(tmpdir(), "spend-capture-"));
    try {
      unwrap(writeCardSnapshot({ home, snapshot: calibration() }));
      const run = harness({
        finalUrl: "https://www.airwallex.com/app/cards/cardholder/card-id",
        responses: [details(), limits(), transactions({ rows: [row({ id: "t1" })], totalCount: 1 })],
      });
      const rest = ["--url", CARD_PAGE, "--store", "--last4", "0042", "--home", home];
      expect(await runSpendCapture({ deps: run.deps, rest })).toBe(0);
      const stored = join(home, "spend", "cards", "airwallex-0042", "2026-09-29.json");
      expect(run.out).toEqual([
        `spend capture --store: card 0042 as of 2026-09-29 — 1 row(s) read of 1 the card holds → ${stored}. ` +
          "`slopweaver spend read --card 0042` reads it",
      ]);
      expect(run.out.join("\n")).not.toContain(REASON);
      const newest = unwrap(readLatestSnapshots({ home, last4: "0042" }))[0]!;
      expect(newest.source.kind).toBe("live");
      expect(newest.transactions[0]!.declineReason).toBe(REASON);
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  });

  it("refuses to store a card no pasted snapshot has calibrated", async () => {
    const home = mkdtempSync(join(tmpdir(), "spend-capture-"));
    try {
      const run = harness({
        finalUrl: "https://www.airwallex.com/app/cards/cardholder/card-id",
        responses: [details(), limits(), transactions({ rows: [], totalCount: 0 })],
      });
      const rest = ["--url", CARD_PAGE, "--store", "--last4", "0042", "--home", home];
      expect(await runSpendCapture({ deps: run.deps, rest })).toBe(1);
      expect(run.out).toEqual([]);
      expect(run.diagnostics[0]).toContain("`spend import` a pasted page of the card once first");
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  });
});
