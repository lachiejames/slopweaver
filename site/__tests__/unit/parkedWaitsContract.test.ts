/*
 * The CONSUMER half of the Fleet page's parked-count contract: the page's own readers (`readWakeReading`, `readBoard`)
 * and `parkedWaitsOf` over the golden the producer test pins
 * (`src/__tests__/unit/cli/commands/handover/wakeRun/fleetParkedContract.test.ts`) — a real `handover wake --json`
 * ledgered the way the tick ledgers it and read back by `reading last`, beside a real `handover list --json` board over
 * the same run journals. A field either producer renames or drops fails here, rather than turning every park on the
 * page into "not measured" while the unit cases, which restate the wire, stay green. The golden is READ,
 * never imported: `site/` is its own Yarn project, and its CI job installs nothing the verbs' graph needs.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readBoard } from "../../components/live/read";
import { readWakeReading } from "../../components/live/readWakeReading";
import { liveVerbFor } from "../../lib/liveVerbs";
import { parkedWaitsOf } from "../../lib/parkedWaits";

/** The golden the producer test writes. */
const GOLDEN = fileURLToPath(
  new URL("../../../src/__tests__/fixtures/contract/fleet-parked-waits.json", import.meta.url),
);

/** The golden's shape, as far as this file reaches into it; every value under it goes through the page's readers. */
interface Golden {
  readonly channelArgv: readonly string[];
  readonly nowIso: string;
  readonly scenarios: Readonly<Record<string, { wake: unknown; boards: Readonly<Record<string, unknown>> }>>;
}

const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as Golden;
const nowMs = Date.parse(golden.nowIso);

/** The lines the page draws for one of the golden's scenarios, over one of its boards. */
function linesOf({ board, scenario }: { board: string; scenario: string }): readonly string[] {
  const { boards, wake } = golden.scenarios[scenario];
  const wakeCi = readWakeReading(wake)!.value;
  return parkedWaitsOf({ nowMs, rows: readBoard(boards[board])!.rows, wakeCi }).lines;
}

describe("the Fleet page reads the wake and board the producers print", () => {
  it("runs exactly the argv the golden's wake reading was read back by", () => {
    expect(liveVerbFor({ slug: "wake-reading" })!.argv).toEqual(golden.channelArgv);
  });

  it("splits every CI park by what the wake found of its pull request, joined on the park's own identity", () => {
    const { boards, wake } = golden.scenarios["split-by-state"];
    const wakeCi = readWakeReading(wake)!.value;
    expect([
      wakeCi.observedAtIso,
      wakeCi.rows.map((row) => [row.slug, row.parkIndex, row.state]),
      readBoard(boards["board"])!.rows.map((row) => [row.slug, row.parkIndex]),
    ]).toEqual([
      golden.nowIso,
      [
        ["closed", 2, "closed"],
        ["finished", 2, "finished"],
        ["merged", 2, "merged"],
        ["running", 2, "running"],
        ["unread", 2, "unknown"],
      ],
      ["merged", "closed", "finished", "running", "unread", "clock"].map((slug) => [slug, 2]),
    ]);
    expect(linesOf({ board: "board", scenario: "split-by-state" })).toEqual([
      "6 more are parked, closed until they wake: 1 on a clock, 1 on CI still running, 1 on an open pull request with no check still running, 1 on a pull request that has merged, 1 on a pull request closed unmerged, 1 on CI the last wake did not read.",
      "3 of them are due now: what they waited on already happened, so the next wake settles or reseats each.",
      "The next clock wake is 04:00Z, in 47m.",
    ]);
  });

  it("never counts a park the wake reseated as parked, when the board was read before that wake finished", () => {
    // The page reads the board once, so it can hold a board older than the wake whose reading it joins.
    // Neither the reseated CI park nor the reseated clock is counted, and the clock's wake is not said to be next;
    // the next board read no longer holds the reseated parks at all.
    expect([
      linesOf({ board: "before", scenario: "board-before-reseat" }),
      linesOf({ board: "after", scenario: "board-before-reseat" }),
    ]).toEqual([
      [
        "1 more is parked on CI still running, closed until it wakes.",
        "2 more on this board are no longer parked: the last wake reseated or settled them after the board was read.",
      ],
      ["1 more is parked on CI still running, closed until it wakes."],
    ]);
  });

  it("drops a park a failed spawn cleared by its dispatch, and keeps one a failed spawn left parked", () => {
    // Both rows say `spawn-failed`; only the journal after the wake says which one still stands.
    const kept = [
      "1 more is parked on a pull request that has merged, closed until it wakes.",
      "1 of them is due now: what it waited on already happened, so the next wake settles or reseats it.",
    ];
    expect(
      ["failed-spawn-dispatched", "failed-spawn-kept"].map((scenario) => [
        linesOf({ board: "before", scenario }),
        linesOf({ board: "after", scenario }),
      ]),
    ).toEqual([
      [
        ["1 more on this board is no longer parked: the last wake reseated or settled it after the board was read."],
        [],
      ],
      [kept, kept],
    ]);
  });
});
