/**
 * `readFleetHealthLive` — the shell half of `tick close`'s fleet health gate — judges each open card's note at the
 * instant it reads it, never at the tick's. A live panel beats about once a second, so judged at a tick instant taken
 * before the close's slower reads, a note on the owner's screen read as gone and refused every close straight after the
 * fire that raised it.
 */
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readFleetHealthLive } from "../../../../../cli/commands/supervisor/fleetHealthRead.js";
import { NO_KIND_ANSWERS } from "../../../../../hand/kindAnswers.js";
import { handNotePanelBuild } from "../../../../../hand/note/panel.js";
import { raiseHandNote } from "../../../../../hand/note/raise.js";
import { buildHandStep, type HandStep } from "../../../../../hand/step.js";
import { appendHandRow } from "../../../../../hand/store.js";
import { unwrap } from "../../../../../lib/result.js";
import { stateHomePaths } from "../../../../../stateHome.js";

/** The tick's own instant: taken when the close began, before its slower reads. */
const TICK = "2026-09-30T06:08:00.000Z";
/** The panel's newest beat, written while the close was still reading. */
const BEAT = "2026-09-30T06:08:03.000Z";
/** The instant the gate actually reads the note. */
const READ = "2026-09-30T06:08:04.000Z";
const ID = "mon-health-0a1b2c";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "fleet-read-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/**
 * The fleet health card as a hand step.
 *
 * @returns the step
 */
function step(): HandStep {
  return unwrap(
    buildHandStep({
      draft: {
        id: ID,
        postedBy: "monitor",
        postedIso: TICK,
        unblocks: "fleet health",
        url: "http://localhost/console",
        what: "Check fleet health — syncs are dying mid-run",
        witness: `slopweaver hand done ${ID}`,
      },
    }),
  );
}

/**
 * Post the card, raise its note through a launch seam that draws nothing, pin the want to the tick, and write the
 * beat the drawn panel would, carrying this checkout's build, stamped at {@link BEAT}.
 */
async function postAndBeat(): Promise<void> {
  unwrap(await appendHandRow({ home, nowIso: TICK, row: { kind: "posted", step: step() } }));
  unwrap(
    raiseHandNote({
      home,
      kindAnswers: NO_KIND_ANSWERS,
      level: "ordinary",
      nowIso: TICK,
      run: () => undefined,
      step: step(),
      whenLive: "keep",
    }),
  );
  const live = join(stateHomePaths({ home }).handSteps, "live");
  const wantPath = join(live, `${ID}.want`);
  utimesSync(wantPath, new Date(TICK), new Date(TICK));
  const beatPath = join(live, `${ID}.${readFileSync(wantPath, "utf8").trim()}.beat`);
  writeFileSync(beatPath, handNotePanelBuild());
  utimesSync(beatPath, new Date(BEAT), new Date(BEAT));
}

/**
 * The notes one read reports, failing the case when the read itself did not happen.
 *
 * @param noteClock the instant the note is judged at
 * @returns each open card's note standing
 */
async function notesAt({ noteClock }: { noteClock: string }): Promise<readonly { stepId: string; standing: string }[]> {
  const read = await readFleetHealthLive({ home, noteClock: () => noteClock, nowIso: TICK });
  expect(read.kind).toBe("read");
  return (read as Extract<typeof read, { kind: "read" }>).notes;
}

describe("readFleetHealthLive", () => {
  it("reads a note beating since the tick began as up, judged at the read's own instant", async () => {
    await postAndBeat();
    expect(await notesAt({ noteClock: READ })).toEqual([{ standing: "up", stepId: ID }]);
  });

  it("would read that same note as absent judged at the tick's instant — the refusal this fix removes", async () => {
    await postAndBeat();
    expect(await notesAt({ noteClock: TICK })).toEqual([{ standing: "absent", stepId: ID }]);
  });
});
