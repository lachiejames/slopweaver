/*
 * The CONSUMER half of the `profile steers --json` contract: the console's reader draws the golden the verb's own
 * integration test cut from the shipped CLI over a real store (`src/__tests__/subprocess/profile/profileSteersContract.test.ts`).
 * The golden is READ, never imported: `site/` is its own Yarn project, and its CI job installs nothing the verb's graph
 * needs.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { readSlackSteers } from "../../components/live/readSlackSteers";

/** The golden the producer test writes. */
const GOLDEN = fileURLToPath(new URL("../../../src/__tests__/fixtures/contract/profile-steers.json", import.meta.url));

describe("the console reads what profile steers --json prints over a real store", () => {
  const reading = readSlackSteers(JSON.parse(readFileSync(GOLDEN, "utf8")));

  it("reads the window and the store's unparsed line by its place in the imported journal", () => {
    expect([reading!.observedAtIso, reading!.sinceIso, reading!.unparsed, reading!.read, reading!.unread]).toEqual([
      "2026-10-20T00:00:00.000Z",
      "2026-08-21T00:00:00.000Z",
      [1],
      0,
      0,
    ]);
  });

  it("draws the one correction the journal held, on its kind's trail", () => {
    expect(reading!.kinds[0]).toEqual({
      kind: "em-dashes",
      lastCorrectedIso: "2026-10-09T23:00:00.000Z",
      points: [
        {
          anchor: "slack:acme/C0FIXTURE/1760000000.000100",
          atIso: "2026-10-09T23:00:00.000Z",
          quote: "no em dashes",
          says: "corrects",
          text: undefined,
        },
      ],
      stoppedIso: undefined,
      title: "Em dashes",
    });
  });

  it("draws every kind, the empty ones as trails with no points", () => {
    expect(reading!.kinds.map((trail) => [trail.kind, trail.points.length])).toEqual([
      ["em-dashes", 1],
      ["voice", 0],
      ["length", 0],
      ["stakeholders", 0],
      ["proof", 0],
      ["place", 0],
      ["withheld", 0],
    ]);
  });
});
