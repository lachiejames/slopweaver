/**
 * The PRODUCER half of the Fleet page's parked-count contract: a real `handover wake --json` run, ledgered the way
 * the tick ledgers it and read back by `reading last` with the page channel's own argv, beside a real `handover list
 * --json` board composed over the same run journals — pinned to ONE golden file the page's readers are tested against.
 *
 * The two halves live in separate Yarn projects and neither may import the other's graph, so they meet in
 * `src/__tests__/fixtures/contract/fleet-parked-waits.json`:
 *
 * - this test runs every scenario through the shipped verbs and asserts the document they print IS the golden. The
 *   temp home and the reading's random id are the only inputs that vary per run, and both are replaced by fixed
 *   tokens before the comparison;
 * - `site/__tests__/unit/parkedWaitsContract.test.ts` reads that golden through `readWakeReading`, `readBoard` and
 *   `parkedWaitsOf`, and asserts the page's exact lines. A field either producer renames or drops fails there,
 *   rather than turning every park on the page into "not measured" while the unit cases, which restate the wire, stay
 *   green.
 *
 * Re-cut the golden with `yarn vitest run --config config/vitest/unit.ts <this file> --update`.
 */
import { statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  boardJsonDocument,
  NO_BOARD_REFERENCES,
  NO_DETACHED_FINDINGS,
} from "../../../../../../cli/commands/handover/listJson.js";
import { runReadingLast } from "../../../../../../cli/commands/reading/last.js";
import { appendToLedger } from "../../../../../../cli/commands/supervisor/scratchLedger.js";
import { journalEvidence } from "../../../../../../handover/assemble.js";
import type { ChecksWakeObservation } from "../../../../../../handover/parkWake.js";
import { EMPTY_TAG_FILTER } from "../../../../../../handover/tagFilter.js";
import { recordReading } from "../../../../../../readings/store.js";
import { tickReadings } from "../../../../../../supervisor/scratch/tickCapture.js";
import { doc, modelsFor, OBSERVED, SCAN_STARTED } from "../../../../handover/listJson/fixtures.js";
import { removeFixtureDirs } from "../../turn/dispatch/harness.js";
import { FUTURE, green, NOW, PAST, record } from "./fixtures.js";
import { fakes, mintWakeHome, parkedRow, wakeJson } from "./harness.js";

/** Where both halves read the contract; relative to this file, as `toMatchFileSnapshot` resolves it. */
const GOLDEN = "../../../../../fixtures/contract/fleet-parked-waits.json";

/** The argv the page's `wake-reading` channel runs; the site half asserts its channel still runs exactly this. */
const CHANNEL_ARGV = ["reading", "last", "--producer", "handover wake", "--json"] as const;

/** When the tick's ledger stamps the wake: twenty minutes after the wake judged its rows, once it has exited. */
const RECORDED_AT = "2026-10-15T03:33:00.000Z";

/** One park per state the page splits by, each on its own pull request of `o/r`. */
const PARKS = [
  { number: 1, slug: "merged" },
  { number: 2, slug: "closed" },
  { number: 3, slug: "finished" },
  { number: 4, slug: "running" },
  { number: 5, slug: "unread" },
] as const;

/** An open head whose one check is still running. */
const RUNNING: ChecksWakeObservation = {
  checks: {
    baseRef: "main",
    checks: [{ kind: "check-run", name: "unit", runId: "102", state: "running", url: undefined }],
    headSha: "abc",
    mergeable: "MERGEABLE",
    residue: [],
    rollupState: "PENDING",
    supersededChecks: [],
    truncated: false,
  },
  prState: "OPEN",
};

/** What one scenario hands the page: the wake reading as `reading last` printed it, and the boards it is joined to. */
interface Scenario {
  readonly wake: unknown;
  readonly boards: Readonly<Record<string, unknown>>;
}

/**
 * The tick's own path, end to end: its declared wake reading ledgered by `appendToLedger` under the producer the tick
 * derives, then read back by `reading last` with the channel's argv.
 *
 * @returns the document `reading last` printed, parsed
 */
function ledgeredWake({ home, printed }: { home: string; printed: string }): unknown {
  const wakeTickReading = tickReadings({ loopSessionKey: "k" }).find((reading) => reading.name === "handover-wake")!;
  const path = join(home, "handover-wake.json");
  writeFileSync(path, printed);
  const diagnostics: string[] = [];
  const readingId = appendToLedger({
    by: "tick-1",
    deps: {
      now: () => RECORDED_AT,
      recordReading: ({ by, document, observedAtIso, producer }) =>
        recordReading({ by, document, home, nowIso: RECORDED_AT, observedAtIso, producer })
          .map((receipt) => receipt.record.readingId)
          .mapErr((error) => error.message),
      writeDiagnostic: (line) => {
        diagnostics.push(line);
      },
    },
    home,
    outcome: {
      argv: wakeTickReading.argv,
      bytes: statSync(path).size,
      child: { durationMs: 10, exitCode: 0, kind: "exited" },
      completed: true,
      errFile: "handover-wake.err",
      exitCode: 0,
      file: "handover-wake.json",
      name: wakeTickReading.name,
    },
    path,
    reading: wakeTickReading,
  });
  const printedBack: string[] = [];
  const lastCode = runReadingLast({
    deps: {
      writeDiagnostic: (line) => {
        diagnostics.push(line);
      },
      writeOut: (line) => {
        printedBack.push(line);
      },
    },
    rest: [...CHANNEL_ARGV.slice(2), "--home", home],
  });
  expect([typeof readingId, lastCode, diagnostics, printedBack.length]).toEqual(["string", 0, [], 1]);
  return JSON.parse(printedBack[0]!.replaceAll(readingId!, "<reading-id>").replaceAll(home, "<home>"));
}

/**
 * The board `handover list --json` composes over these rows' journals as they stand.
 *
 * @returns the board document, as the page's channel would carry it
 */
function boardOf({ home, runsDir, slugs }: { home: string; runsDir: string; slugs: readonly string[] }): unknown {
  const docs = slugs.map((slug) => doc({ slug, status: "in-progress" }));
  const journals = journalEvidence({ docs, runsDir });
  const document = boardJsonDocument({
    detached: NO_DETACHED_FINDINGS,
    filter: EMPTY_TAG_FILTER,
    handoverDir: "/h",
    models: modelsFor({ docs, journals }),
    observedAtIso: OBSERVED,
    references: NO_BOARD_REFERENCES,
    scanStartedIso: SCAN_STARTED,
    unreadable: [],
    unresolved: 0,
  });
  return JSON.parse(JSON.stringify(document).replaceAll(home, "<home>"));
}

/** Every CI state the page splits by, on one board, with a clock park beside them; the wake is a dry run. */
async function splitByState(): Promise<Scenario> {
  const { home, runsDir } = mintWakeHome();
  for (const { number, slug } of PARKS) {
    parkedRow({ slug, wake: { kind: "checks", number, repo: "o/r" } });
  }
  parkedRow({ slug: "clock", wake: { atIso: FUTURE, kind: "at" } });
  const recorded = record();
  await wakeJson({
    deps: fakes({
      checks: { 1: { prState: "MERGED" }, 2: { prState: "CLOSED" }, 3: green(), 4: RUNNING, 5: "error" },
      recorded,
    }),
    extra: ["--dry-run"],
    recorded,
  });
  const board = boardOf({ home, runsDir, slugs: [...PARKS.map(({ slug }) => slug), "clock"] });
  return { boards: { board }, wake: ledgeredWake({ home, printed: recorded.out[0]! }) };
}

/** A board read before a wake that reseated two of its parks, and the board read after it. */
async function boardBeforeReseat(): Promise<{ scenario: Scenario; spawned: readonly unknown[] }> {
  const { home, runsDir } = mintWakeHome();
  parkedRow({ slug: "due-clock", wake: { atIso: PAST, kind: "at" } });
  parkedRow({ slug: "reseated", wake: { kind: "checks", number: 3, repo: "o/r" } });
  parkedRow({ slug: "running", wake: { kind: "checks", number: 4, repo: "o/r" } });
  const slugs = ["due-clock", "reseated", "running"];
  const before = boardOf({ home, runsDir, slugs });
  const recorded = record();
  const { report } = await wakeJson({ deps: fakes({ checks: { 3: green(), 4: RUNNING }, recorded }), recorded });
  const wake = ledgeredWake({ home, printed: recorded.out[0]! });
  const after = boardOf({ home, runsDir, slugs });
  const spawned = [recorded.spawned.toSorted(), report.rows.map((row) => [row.slug, row.action])];
  return { scenario: { boards: { after, before }, wake }, spawned };
}

/** A failed spawn on a merged pull request whose dispatch either cleared the park or left it standing. */
async function failedSpawn({ leftOpen, slug }: { leftOpen: boolean; slug: string }): Promise<{
  actions: readonly string[];
  scenario: Scenario;
}> {
  const { home, runsDir } = mintWakeHome();
  parkedRow({ slug, wake: { kind: "checks", number: 6, repo: "o/r" } });
  const before = boardOf({ home, runsDir, slugs: [slug] });
  const recorded = record();
  const deps = fakes({ checks: { 6: { prState: "MERGED" } }, exitCode: 1, leftOpen, recorded });
  const { report } = await wakeJson({ deps, recorded });
  const wake = ledgeredWake({ home, printed: recorded.out[0]! });
  const after = boardOf({ home, runsDir, slugs: [slug] });
  return { actions: report.rows.map((row) => row.action), scenario: { boards: { after, before }, wake } };
}

describe("handover wake and handover list --json, the contract the Fleet page's parked count reads", () => {
  afterEach(() => {
    removeFixtureDirs();
  });

  it("prints exactly the golden the page's readers are tested against", async () => {
    const split = await splitByState();
    const reseat = await boardBeforeReseat();
    const dispatched = await failedSpawn({ leftOpen: true, slug: "dispatched" });
    const kept = await failedSpawn({ leftOpen: false, slug: "kept" });

    // What the golden's later scenarios stand on, which the page cannot see: who was reseated, and how each spawn ended.
    expect([reseat.spawned, dispatched.actions, kept.actions]).toEqual([
      [
        ["due-clock", "reseated"],
        [
          ["due-clock", "spawned"],
          ["reseated", "spawned"],
          ["running", "none"],
        ],
      ],
      ["spawn-failed"],
      ["spawn-failed"],
    ]);
    const golden = {
      channelArgv: CHANNEL_ARGV,
      nowIso: NOW.toISOString(),
      scenarios: {
        "board-before-reseat": reseat.scenario,
        "failed-spawn-dispatched": dispatched.scenario,
        "failed-spawn-kept": kept.scenario,
        "split-by-state": split,
      },
    };
    await expect(`${JSON.stringify(golden, null, 2)}\n`).toMatchFileSnapshot(GOLDEN);
  });
});
