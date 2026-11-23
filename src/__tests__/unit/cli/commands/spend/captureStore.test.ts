import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CapturedResponse, PageCapture } from "../../../../../browser/pageTransport.js";
import { storeLiveCapture } from "../../../../../cli/commands/spend/captureStore.js";
import type { SpendDeps } from "../../../../../cli/commands/spend/run.js";
import { unwrap } from "../../../../../lib/result.js";
import { readLatestSnapshots, writeCardSnapshot } from "../../../../../spend/store.js";
import { calibration, details, limits, row, transactions } from "../../../spend/liveFixture.js";

/** A settled capture of the card page that heard the responses given. */
const capture = ({ responses }: { responses: readonly CapturedResponse[] }): PageCapture => ({
  finalUrl: "https://www.airwallex.com/app/cards/cardholder/card-id",
  links: [],
  linksBlockedBecause: null,
  observedAt: "2026-09-29T10:35:00.000Z",
  requestedUrl: "https://www.airwallex.com/app/cards/cardholder/card-id",
  responseAccounting: { bodyFailed: 0, bodySucceeded: responses.length, eligible: responses.length, seen: 12 },
  responses,
  screenshotBlockedBecause: null,
  screenshotPng: null,
  statusCode: 200,
  title: "Airwallex",
});

/** Edges recording the lines each stream received. */
const streams = (): { deps: SpendDeps; diagnostics: string[]; out: string[] } => {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const deps: SpendDeps = {
    defaultHome: () => "/unused-home",
    now: () => "2026-09-29T10:35:00.000Z",
    readFile: () => "",
    writeDiagnostic: (line) => {
      diagnostics.push(line);
    },
    writeOut: (line) => {
      out.push(line);
    },
  };
  return { deps, diagnostics, out };
};

describe("storeLiveCapture", () => {
  let home = "";
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "spend-store-"));
    unwrap(writeCardSnapshot({ home, snapshot: calibration() }));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("prints the stored path and counts as one JSON document", () => {
    const run = streams();
    const responses = [details(), limits(), transactions({ rows: [row({ id: "t1" })], totalCount: 4 })];
    const code = storeLiveCapture({
      capture: capture({ responses }),
      deps: run.deps,
      home,
      json: true,
      last4: "0042",
      timeZone: "Australia/Sydney",
    });
    expect(code).toBe(0);
    expect(JSON.parse(run.out[0]!)).toEqual({
      asOf: "2026-09-29",
      path: join(home, "spend", "cards", "airwallex-0042", "2026-09-29.json"),
      rowsOnCard: 4,
      rowsRead: 1,
    });
  });

  it("writes nothing when the live read does not calibrate", () => {
    const run = streams();
    const code = storeLiveCapture({
      capture: capture({
        responses: [details(), limits({ limitAmount: 3000 }), transactions({ rows: [], totalCount: 0 })],
      }),
      deps: run.deps,
      home,
      json: false,
      last4: "0042",
      timeZone: "Australia/Sydney",
    });
    expect(code).toBe(1);
    expect(run.out).toEqual([]);
    expect(run.diagnostics[0]).toContain("does not calibrate against the stored snapshot, so nothing was stored");
    expect(unwrap(readLatestSnapshots({ home, last4: "0042" }))[0]!.source.kind).toBe("pasted");
  });
});
