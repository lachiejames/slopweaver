/**
 * The fleet-health note's memory: written only after a FIRED pass really posted the card, forgotten when the fleet
 * reads clear, and read as no memory — never a swallowed note — when it will not parse.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readFleetHealthShown, recordFleetHealthShown, shownOf } from "../../../monitor/fleetHealthShown.js";
import type { PassOutcome } from "../../../monitor/pass.js";
import type { FleetHealthShown, MonitorReading } from "../../../monitor/types.js";
import { stateHomePaths } from "../../../stateHome.js";

const SHOWN: FleetHealthShown = {
  botDown: false,
  broken: ["atlas-hex", "resync-corpus-slack"],
  shownIso: "2026-09-30T00:13:00.000Z",
  signals: ["syncs"],
  yours: ["resync-atlas-xero mon-signin-go-xero-com"],
};

const FIRING: MonitorReading = {
  monitorId: "fleet-unhealthy",
  state: "firing",
  subjects: [
    {
      delivery: { kind: "recut" },
      fleet: {
        delta: {
          bot: "up",
          handMoved: [],
          newlyFailing: SHOWN.broken,
          recovered: [],
          stillFailing: [],
          tripped: ["syncs"],
          untripped: [],
        },
        shown: SHOWN,
      },
      id: "fleet health",
      key: "syncs",
      label: "as of 00:13Z",
    },
  ],
};

describe("shownOf", () => {
  it("accepts a remembered note, sorting its rows and the rows it gave a button", () => {
    expect(
      shownOf({
        value: {
          botDown: true,
          broken: ["b", "a"],
          shownIso: SHOWN.shownIso,
          signals: ["deaths"],
          yours: ["b card-b", "a card-a"],
        },
      }),
    ).toEqual({
      botDown: true,
      broken: ["a", "b"],
      shownIso: SHOWN.shownIso,
      signals: ["deaths"],
      yours: ["a card-a", "b card-b"],
    });
  });

  it("reads a note remembered before notes carried buttons as one that gave none", () => {
    expect(shownOf({ value: { botDown: false, broken: ["a"], shownIso: SHOWN.shownIso, signals: ["syncs"] } })).toEqual(
      { botDown: false, broken: ["a"], shownIso: SHOWN.shownIso, signals: ["syncs"], yours: [] },
    );
  });

  it("refuses anything that is not one", () => {
    expect(
      [
        null,
        { botDown: false, broken: [], shownIso: "not an instant", signals: [] },
        { botDown: "no", broken: [], shownIso: SHOWN.shownIso, signals: [] },
        { botDown: false, broken: [1], shownIso: SHOWN.shownIso, signals: [] },
        { botDown: false, shownIso: SHOWN.shownIso, signals: [] },
        { botDown: false, broken: [], shownIso: SHOWN.shownIso },
        { botDown: false, broken: [], shownIso: SHOWN.shownIso, signals: [], yours: "a card-a" },
      ].map((value) => shownOf({ value })),
    ).toEqual([undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
  });
});

describe("recordFleetHealthShown and readFleetHealthShown", () => {
  let home: string;
  let path: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "fleet-shown-"));
    path = stateHomePaths({ home }).fleetHealthShownJson;
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("reads no memory, and no problem, before any note went up", () => {
    expect(readFleetHealthShown({ home })).toEqual({ problem: undefined, shown: undefined });
  });

  it("remembers what a POSTED card showed, and reads it back", () => {
    const outcome: PassOutcome = {
      actions: [{ detail: "posted", kind: "posted", monitorId: "fleet-unhealthy", stepId: "mon-health-syncs.3" }],
      readings: [FIRING],
    };
    expect(recordFleetHealthShown({ home, outcome })).toEqual([
      {
        detail: "remembered 2 failing row(s) as shown, so the next note says what changed",
        kind: "noted",
        monitorId: "fleet-unhealthy",
        stepId: "mon-health-syncs.3",
      },
    ]);
    expect(readFleetHealthShown({ home })).toEqual({ problem: undefined, shown: SHOWN });
  });

  it("leaves the memory alone when the card was held, so the news waits for the note that shows it", () => {
    const outcome: PassOutcome = {
      actions: [{ detail: "nothing changed", kind: "held", monitorId: "fleet-unhealthy", stepId: "fleet-unhealthy" }],
      readings: [FIRING],
    };
    expect(recordFleetHealthShown({ home, outcome })).toEqual([]);
    expect(existsSync(path)).toBe(false);
  });

  it("forgets the last note when the fleet reads clear, so its next breakage is news", () => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(SHOWN));
    const outcome: PassOutcome = { actions: [], readings: [{ monitorId: "fleet-unhealthy", state: "clear" }] };
    expect(recordFleetHealthShown({ home, outcome })).toEqual([]);
    expect(existsSync(path)).toBe(false);
  });

  it("keeps the memory through a pass that could not measure the fleet", () => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(SHOWN));
    const outcome: PassOutcome = {
      actions: [],
      readings: [{ because: "the ledger would not list", monitorId: "fleet-unhealthy", state: "unmeasurable" }],
    };
    expect(recordFleetHealthShown({ home, outcome })).toEqual([]);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(SHOWN);
  });

  it("reads a torn memory as none, and says why", () => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{");
    const read = readFleetHealthShown({ home });
    expect(read.shown).toBe(undefined);
    expect(read.problem).toContain("is not JSON");
  });
});
