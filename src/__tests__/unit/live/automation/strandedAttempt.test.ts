/**
 * `findStrandedAttempt` over a throwaway ledger: the newest earlier firing whose run started and died, found
 * behind the slot being taken, passed over while its holder still runs, and bounded by a count of firings.
 *
 * Hourly cadence, so every instant here is one of the row's firings in any whole-hour timezone — cron reads
 * the process's own zone. The pid probe is a plain function answering as given, never a mock.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CronExpressionParser } from "cron-parser";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openSlotAttempt } from "../../../../live/automation/slotAttempt.js";
import { slotAttemptKey } from "../../../../live/automation/slotLedger.js";
import { findStrandedAttempt, STRANDED_LOOKBACK } from "../../../../live/automation/strandedAttempt.js";
import { stateHomePaths } from "../../../../stateHome.js";

const RECIPE = "resync-atlas-calendar";
const HOUR_MS = 3_600_000;
/** The firing being taken, and the instant it is taken at — past every earlier firing's lease. */
const TAKEN = "2026-09-26T18:00:00.000Z";
const NOW = "2026-09-26T18:30:00.000Z";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "stranded-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** The firing `hours` before {@link TAKEN}. */
const hoursBefore = ({ hours }: { hours: number }): string =>
  new Date(Date.parse(TAKEN) - hours * HOUR_MS).toISOString();

/** An attempt that started its run under a pid on `slotIso`, leased until the firing after it. */
function startedOn({ slotIso }: { slotIso: string }): void {
  const attempt = openSlotAttempt({
    attempt: 1,
    holder: "recipe run-due",
    holderPid: 4242,
    holderToken: "tok-stranded",
    leaseExpiresIso: new Date(Date.parse(slotIso) + HOUR_MS).toISOString(),
    nowIso: new Date(Date.parse(slotIso) + 5 * 60_000).toISOString(),
    recipeId: RECIPE,
    slotIso,
  });
  const dir = stateHomePaths({ home }).live.recipe.slotAttemptsDir;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${slotAttemptKey({ recipeId: RECIPE, slotIso })}.json`), JSON.stringify(attempt), "utf8");
}

/**
 * Ask for a stranded attempt behind {@link TAKEN}, with every holder pid answering `alive`, and no lifted failure
 * hold covering any of them unless one is given.
 */
function find({
  alive,
  coveredBeforeIso = null,
}: {
  alive: boolean;
  coveredBeforeIso?: string | null;
}): ReturnType<typeof findStrandedAttempt> {
  return findStrandedAttempt({
    cadence: "0 * * * *",
    coveredBeforeIso,
    home,
    nowIso: NOW,
    processAlive: () => alive,
    recipeId: RECIPE,
    slotIso: TAKEN,
  });
}

describe("findStrandedAttempt", () => {
  it("answers null over an empty ledger", () => {
    expect(find({ alive: false })).toBe(null);
  });

  it("finds a run that started on an earlier firing and whose holder is gone", () => {
    startedOn({ slotIso: hoursBefore({ hours: 3 }) });

    const stranded = find({ alive: false })!;

    expect(stranded.slotIso).toBe(hoursBefore({ hours: 3 }));
    expect(stranded.verdict.kind).toBe("abandoned");
    expect(stranded.verdict.ran).toBe(true);
    expect(stranded.verdict.attempt).toBe(1);
  });

  it("answers the NEWEST stranded firing when two stand behind the slot", () => {
    startedOn({ slotIso: hoursBefore({ hours: 5 }) });
    startedOn({ slotIso: hoursBefore({ hours: 2 }) });

    expect(find({ alive: false })!.slotIso).toBe(hoursBefore({ hours: 2 }));
  });

  it("passes over a holder that still runs past its lease — a long run, not a dead one", () => {
    startedOn({ slotIso: hoursBefore({ hours: 1 }) });

    expect(find({ alive: true })).toBe(null);
  });

  it("passes over a death TAKEN before the lifted failure hold was placed — its fix already answered it", () => {
    // Taken five minutes after its firing, so the hold placed at the firing plus ten minutes covers it.
    startedOn({ slotIso: hoursBefore({ hours: 6 }) });

    const covered = new Date(Date.parse(hoursBefore({ hours: 6 })) + 10 * 60_000).toISOString();

    expect(find({ alive: false, coveredBeforeIso: covered })).toBe(null);
  });

  it("still finds a death taken AFTER the lifted failure hold was placed — a fresh failure, not the fixed one", () => {
    startedOn({ slotIso: hoursBefore({ hours: 2 }) });

    expect(find({ alive: false, coveredBeforeIso: hoursBefore({ hours: 4 }) })!.slotIso).toBe(
      hoursBefore({ hours: 2 }),
    );
  });

  it("reads back exactly STRANDED_LOOKBACK firings and no further", () => {
    startedOn({ slotIso: hoursBefore({ hours: STRANDED_LOOKBACK }) });
    expect(find({ alive: false })!.slotIso).toBe(hoursBefore({ hours: STRANDED_LOOKBACK }));

    rmSync(stateHomePaths({ home }).live.recipe.slotAttemptsDir, { force: true, recursive: true });
    startedOn({ slotIso: hoursBefore({ hours: STRANDED_LOOKBACK + 1 }) });
    expect(find({ alive: false })).toBe(null);
  });
});

/**
 * A row whose cadence CHANGED after a run died: `resync-corpus-gmail` moved from every four hours to every twelve
 * after a repair, and its dead early-morning attempt was no longer one of the row's firings. The slot being taken is read
 * off the parser, so it is a real twelve-hourly firing in whichever zone cron reads; every off-cadence death below
 * sits on a whole UTC hour an odd number of hours behind that firing's own hour, which no twelve-hourly firing is
 * in any zone.
 */
describe("findStrandedAttempt after a cadence change", () => {
  const CADENCE = "0 */12 * * *";
  const takenMs = CronExpressionParser.parse(CADENCE, { currentDate: new Date(TAKEN) })
    .prev()
    .getTime();
  const takenIso = new Date(takenMs).toISOString();
  /** The whole UTC hour at or before the slot being taken — the slot itself in any whole-hour zone. */
  const takenHourMs = Math.floor(takenMs / HOUR_MS) * HOUR_MS;

  /** The whole UTC hour `hours` before {@link takenHourMs}. */
  const offCadence = ({ hours }: { hours: number }): string => new Date(takenHourMs - hours * HOUR_MS).toISOString();

  /** The row's own firing `firings` before the slot being taken. */
  const firingBefore = ({ firings }: { firings: number }): string => {
    const iterator = CronExpressionParser.parse(CADENCE, { currentDate: new Date(takenIso) });
    let firing = takenIso;
    for (let walked = 0; walked < firings; walked += 1) {
      firing = new Date(iterator.prev().getTime()).toISOString();
    }
    return firing;
  };

  /** Ask behind the twelve-hourly firing, half an hour after it, with every holder pid gone. */
  const findAfterChange = (): ReturnType<typeof findStrandedAttempt> =>
    findStrandedAttempt({
      cadence: CADENCE,
      coveredBeforeIso: null,
      home,
      nowIso: new Date(takenMs + 30 * 60_000).toISOString(),
      processAlive: () => false,
      recipeId: RECIPE,
      slotIso: takenIso,
    });

  it("finds a death on a whole hour the row's current cadence never fires", () => {
    startedOn({ slotIso: offCadence({ hours: 5 }) });

    const stranded = findAfterChange()!;

    expect(stranded.slotIso).toBe(offCadence({ hours: 5 }));
    expect(stranded.verdict.ran).toBe(true);
  });

  it("answers the newest death across the cadence's firings and the whole hours", () => {
    startedOn({ slotIso: firingBefore({ firings: 1 }) });
    startedOn({ slotIso: offCadence({ hours: 5 }) });
    expect(findAfterChange()!.slotIso).toBe(offCadence({ hours: 5 }));

    rmSync(stateHomePaths({ home }).live.recipe.slotAttemptsDir, { force: true, recursive: true });
    startedOn({ slotIso: firingBefore({ firings: 1 }) });
    startedOn({ slotIso: offCadence({ hours: 23 }) });
    expect(findAfterChange()!.slotIso).toBe(firingBefore({ firings: 1 }));
  });

  it("still walks the whole hours when cron cannot step back across a half-hour clock change", () => {
    // Lord Howe springs forward 30 minutes at 02:00 local on the first Sunday of October, and cron-parser's
    // prev() throws "loop limit exceeded" walking back over it.
    const zoneBefore = process.env["TZ"];
    process.env["TZ"] = "Australia/Lord_Howe";
    try {
      const slotIso = "2026-10-04T00:00:00.000Z";
      const deathIso = "2026-10-03T12:00:00.000Z";
      startedOn({ slotIso: deathIso });

      const stranded = findStrandedAttempt({
        cadence: "0 * * * *",
        coveredBeforeIso: null,
        home,
        nowIso: "2026-10-04T02:00:00.000Z",
        processAlive: () => false,
        recipeId: RECIPE,
        slotIso,
      })!;

      expect(stranded.slotIso).toBe(deathIso);

      // Just after that change cron's prev() can step FORWARD — from a half-hour past the hour it answers a later
      // instant still — and a take must never judge a firing that is not behind it.
      rmSync(stateHomePaths({ home }).live.recipe.slotAttemptsDir, { force: true, recursive: true });
      startedOn({ slotIso: "2026-10-03T15:56:00.000Z" });
      const ahead = findStrandedAttempt({
        cadence: "*/4 * * * *",
        coveredBeforeIso: null,
        home,
        nowIso: "2026-10-03T17:30:00.000Z",
        processAlive: () => false,
        recipeId: RECIPE,
        slotIso: "2026-10-03T15:32:00.000Z",
      });

      expect(ahead).toBe(null);
    } finally {
      if (zoneBefore === undefined) {
        delete process.env["TZ"];
      } else {
        process.env["TZ"] = zoneBefore;
      }
    }
  });

  it("reads whole hours back STRANDED_LOOKBACK hours and no further", () => {
    startedOn({ slotIso: offCadence({ hours: STRANDED_LOOKBACK - 1 }) });
    expect(findAfterChange()!.slotIso).toBe(offCadence({ hours: STRANDED_LOOKBACK - 1 }));

    rmSync(stateHomePaths({ home }).live.recipe.slotAttemptsDir, { force: true, recursive: true });
    startedOn({ slotIso: offCadence({ hours: STRANDED_LOOKBACK + 1 }) });
    expect(findAfterChange()).toBe(null);
  });
});
