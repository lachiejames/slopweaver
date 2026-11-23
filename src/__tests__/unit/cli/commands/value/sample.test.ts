/**
 * `value sample` end to end over a throwaway home and plain fakes (`./sampleFixtures.ts`): a first run keeps the
 * week's sample, publishes its page and places its card; a re-run shows the kept one; a week with nothing ended exits
 * 3; a page that will not publish exits 1 and places no card. The draw itself is `./sampleDraw.test.ts`'s.
 */
import { rmSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { ok } from "#lib/result.js";

import { SAMPLE_USAGE } from "../../../../../cli/commands/value/core.js";
import { runValueSample } from "../../../../../cli/commands/value/sample.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../../cli/exitCodes.js";
import { boardRow, fakeDeps, freshHome, mintedHomes, WEEK } from "./sampleFixtures.js";

afterEach(() => {
  for (const home of mintedHomes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

describe("value sample", () => {
  it("draws the week's sample, publishes its page and places its one card", async () => {
    const home = freshHome();
    const { deps, seen } = fakeDeps();

    expect(await runValueSample({ deps, rest: ["--home", home] })).toBe(EXIT_OK);

    expect(seen.published).toEqual(["value-sample-2026-w48"]);
    expect(seen.cards).toEqual([{ pageUrl: "slopweaver-page://value-sample-2026-w48", week: WEEK }]);
    expect(seen.out).toEqual([
      "value sample: 2026-W48, 1 of 1 asks, drawn now",
      "  page slopweaver-page://value-sample-2026-w48",
      "  card value-sample-2026-w48: placed",
    ]);
  });

  it("shows the kept sample on a re-run in the same week", async () => {
    const home = freshHome();
    const { deps, seen } = fakeDeps();
    await runValueSample({ deps, rest: ["--home", home] });

    expect(await runValueSample({ deps, rest: ["--home", home] })).toBe(EXIT_OK);

    expect(seen.out.at(-3)).toBe("value sample: 2026-W48, 1 of 1 asks, kept from an earlier run this week");
    expect(seen.rowReads).toEqual([home]);
  });

  it("exits 3 when no ask ended in the window, publishing nothing", async () => {
    const home = freshHome();
    const { deps, seen } = fakeDeps({ rows: ok([boardRow({ settledIso: undefined })]) });

    expect(await runValueSample({ deps, rest: ["--home", home] })).toBe(EXIT_EXPECTED_EMPTY);

    expect(seen.diagnostics).toEqual([
      "value sample: no ask ended filed or answered in the seven days before 2026-11-25T12:00:00.000Z",
    ]);
    expect(seen.published).toEqual([]);
  });

  it("exits 1 and places no card when the page will not publish", async () => {
    const home = freshHome();
    const { deps, seen } = fakeDeps({ publishFails: "the page store is read-only" });

    expect(await runValueSample({ deps, rest: ["--home", home] })).toBe(EXIT_ERROR);

    expect(seen.diagnostics).toEqual(["value sample: the page was not published: the page store is read-only"]);
    expect(seen.cards).toEqual([]);
  });

  it("prints its usage for --help and reads nothing", async () => {
    const { deps, seen } = fakeDeps();

    expect(await runValueSample({ deps, rest: ["--help"] })).toBe(EXIT_OK);

    expect(seen.out).toEqual([SAMPLE_USAGE]);
    expect(seen.rowReads).toEqual([]);
  });
});
