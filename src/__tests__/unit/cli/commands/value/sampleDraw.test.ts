/**
 * `weekSample` over a throwaway home: a first draw joins each ask's cost and pull requests and keeps the sample, a
 * second read finds it without drawing again, and a week with nothing to sample writes nothing. Fakes from
 * `./sampleFixtures.ts`; the sample file is real.
 */
import { rmSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { err, ok, unwrap } from "#lib/result.js";

import { weekSample } from "../../../../../cli/commands/value/sampleDraw.js";
import { readSample } from "../../../../../value/store.js";
import { boardRow, fakeDeps, freshHome, mintedHomes, NOW, PR_URL, WEEK } from "./sampleFixtures.js";

afterEach(() => {
  for (const home of mintedHomes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

describe("weekSample", () => {
  it("draws the one ask that ended this week, joins its cost and pull request, and keeps the sample", async () => {
    const home = freshHome();
    const { deps, seen } = fakeDeps();

    const drawn = unwrap(await weekSample({ deps, home, nowIso: NOW, week: WEEK }))!;

    expect(drawn.kept).toBe(false);
    expect(drawn.sample.eligible).toBe(1);
    expect(drawn.sample.asks).toEqual([
      {
        artifact: undefined,
        cost: { known: true, value: { coveredTurns: 2, totalTurns: 2, transcripts: 1, units: 150 } },
        prUrls: [PR_URL],
        prs: [{ state: "MERGED", url: PR_URL }],
        settledIso: "2026-11-24T09:00:00.000Z",
        settlement: "answered",
        slug: "acme-ask",
        summary: "Export the widget report",
        witness: "https://acme.slack.com/archives/C0FIXTURE/p1",
      },
    ]);
    expect(seen.prReads).toEqual(["acme/widgets#7"]);
    expect(unwrap(readSample({ home, week: WEEK }))).toEqual(drawn.sample);
  });

  it("reads the kept sample back on a second run without reading the board again", async () => {
    const home = freshHome();
    const { deps, seen } = fakeDeps();
    const first = unwrap(await weekSample({ deps, home, nowIso: NOW, week: WEEK }))!;

    const second = unwrap(await weekSample({ deps, home, nowIso: NOW, week: WEEK }))!;

    expect(second).toEqual({ kept: true, sample: first.sample });
    expect(seen.rowReads).toEqual([home]);
  });

  it("answers nothing to sample when no ask ended in the window, and keeps no file", async () => {
    const home = freshHome();
    const { deps } = fakeDeps({ rows: ok([boardRow({ kind: "doc" }), boardRow({ settlement: "dropped" })]) });

    expect(unwrap(await weekSample({ deps, home, nowIso: NOW, week: WEEK }))).toBeUndefined();
    expect(unwrap(readSample({ home, week: WEEK }))).toBeUndefined();
  });

  it("names why no cost was measured when the session ledger will not read", async () => {
    const home = freshHome();
    const { deps } = fakeDeps({ spawns: err(["the session log is truncated"]) });

    const drawn = unwrap(await weekSample({ deps, home, nowIso: NOW, week: WEEK }))!;

    expect(drawn.sample.asks.map((ask) => ask.cost)).toEqual([
      { known: false, why: "the session ledger would not read: the session log is truncated" },
    ]);
  });

  it("refuses a board that will not scan, keeping no file", async () => {
    const home = freshHome();
    const { deps } = fakeDeps({ rows: err(["the board would not scan: no handover directory"]) });

    const drawn = await weekSample({ deps, home, nowIso: NOW, week: WEEK });

    expect(drawn._unsafeUnwrapErr()).toEqual(["the board would not scan: no handover directory"]);
    expect(unwrap(readSample({ home, week: WEEK }))).toBeUndefined();
  });
});
