/**
 * `noteStanding` — whether one step's note is on screen, taken down, or neither, read off the files a raise and a
 * panel leave. The fleet health gate refuses a tripped tick on `absent`, so a failed raise must read as `absent`
 * and the owner's Later must not.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { NO_KIND_ANSWERS } from "../../../hand/kindAnswers.js";
import { laterLedgerDir, rememberLaterPresses } from "../../../hand/laterPresses.js";
import { CLOSED_BEAT } from "../../../hand/note/liveness.js";
import { dismissHandNote } from "../../../hand/note/markers.js";
import { handNotePanelBuild } from "../../../hand/note/panel.js";
import { noteStanding, raiseHandNote } from "../../../hand/note/raise.js";
import { buildHandStep, type HandStep } from "../../../hand/step.js";
import { unwrap } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";

const RAISED = "2026-09-29T16:00:00.000Z";
const JUST_AFTER = "2026-09-29T16:00:05.000Z";
const LONG_AFTER = "2026-09-29T16:10:00.000Z";
const ID = "mon-health-deaths-0a1b2c";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "standing-"));
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
        postedIso: RAISED,
        unblocks: "fleet health",
        url: "http://localhost/console",
        what: "Check fleet health — syncs are dying mid-run",
        witness: `slopweaver hand done ${ID}`,
      },
    }),
  );
}

/**
 * Raise the step's note through a launch seam, then pin the want file's time to {@link RAISED} so the startup
 * window is judged against a fixed instant rather than the wall clock.
 *
 * @param launches whether the launch seam succeeds
 */
function raise({ launches }: { launches: boolean }): void {
  raiseHandNote({
    home,
    kindAnswers: NO_KIND_ANSWERS,
    level: "ordinary",
    nowIso: RAISED,
    run: () => {
      if (!launches) {
        throw new Error("open: the panel would not launch");
      }
    },
    step: step(),
    whenLive: "keep",
  });
  const at = new Date(RAISED);
  utimesSync(join(stateHomePaths({ home }).handSteps, "live", `${ID}.want`), at, at);
}

/**
 * Write the beat the wanted panel would, stamped at `at`.
 *
 * @param at the instant the panel last beat
 * @param build the program the panel runs — this checkout's unless a case says, or the closed marker
 */
function beat({ at, build = handNotePanelBuild() }: { at: string; build?: string }): void {
  const live = join(stateHomePaths({ home }).handSteps, "live");
  const token = readFileSync(join(live, `${ID}.want`), "utf8").trim();
  const path = join(live, `${ID}.${token}.beat`);
  writeFileSync(path, build);
  utimesSync(path, new Date(at), new Date(at));
}

describe("noteStanding", () => {
  it("reads a step no raise ever reached as absent", () => {
    expect(unwrap(noteStanding({ clock: () => JUST_AFTER, home, id: ID }))).toBe("absent");
  });

  it("reads a raise whose launch threw as absent — the failure the gate exists for", () => {
    raise({ launches: false });
    expect(unwrap(noteStanding({ clock: () => JUST_AFTER, home, id: ID }))).toBe("absent");
  });

  it("reads a launched note still inside its startup window as up", () => {
    raise({ launches: true });
    expect(unwrap(noteStanding({ clock: () => JUST_AFTER, home, id: ID }))).toBe("up");
  });

  it("reads a launched note that never beat, judged past the window, as absent", () => {
    raise({ launches: true });
    expect(unwrap(noteStanding({ clock: () => LONG_AFTER, home, id: ID }))).toBe("absent");
  });

  it("reads a note beating AFTER the instant it is judged at as absent — so a reader must judge at its own read", () => {
    raise({ launches: true });
    beat({ at: JUST_AFTER });
    expect(unwrap(noteStanding({ clock: () => JUST_AFTER, home, id: ID }))).toBe("up");
    expect(unwrap(noteStanding({ clock: () => "2026-09-29T16:00:04.000Z", home, id: ID }))).toBe("absent");
  });

  it("reads the clock only once the note's files are read, so a beat written before the read is never its future", () => {
    raise({ launches: true });
    // The panel beats while the clock is being read; read before the files, that beat would be in the clock's future.
    const standing = noteStanding({
      clock: () => {
        beat({ at: JUST_AFTER });
        return "2026-09-29T16:00:04.000Z";
      },
      home,
      id: ID,
    });
    expect(unwrap(standing)).toBe("up");
  });

  it("judges a beat at whole milliseconds, so one written inside the clock's own millisecond is not its future", () => {
    raise({ launches: true });
    beat({ at: "2026-09-29T16:00:04.000Z" });
    const live = join(stateHomePaths({ home }).handSteps, "live");
    const token = readFileSync(join(live, `${ID}.want`), "utf8").trim();
    // utimes takes seconds; 0.6ms past the clock's own millisecond.
    const withinTheMillisecond = Date.parse("2026-09-29T16:00:04.000Z") / 1000 + 0.0006;
    utimesSync(join(live, `${ID}.${token}.beat`), withinTheMillisecond, withinTheMillisecond);
    expect(unwrap(noteStanding({ clock: () => "2026-09-29T16:00:04.000Z", home, id: ID }))).toBe("up");
  });

  it("reads a note drawn by an older panel program as up — the next raise replaces it, but the owner is looking at it", () => {
    raise({ launches: true });
    beat({ at: JUST_AFTER, build: "849a15c356788826" });
    expect(unwrap(noteStanding({ clock: () => JUST_AFTER, home, id: ID }))).toBe("up");
  });

  it("reads a note that closed itself as absent, whatever build it ran", () => {
    raise({ launches: true });
    beat({ at: JUST_AFTER, build: CLOSED_BEAT });
    expect(unwrap(noteStanding({ clock: () => JUST_AFTER, home, id: ID }))).toBe("absent");
  });

  it("reads a note the owner took down with Later as dismissed, not absent", () => {
    raise({ launches: true });
    unwrap(dismissHandNote({ home, id: ID, nowIso: JUST_AFTER }));
    expect(unwrap(noteStanding({ clock: () => LONG_AFTER, home, id: ID }))).toBe("dismissed");
  });

  /* The owner's Later as a reconcile leaves it: written to the ledger, its marker gone. */
  function laterConsumed(): void {
    raise({ launches: true });
    unwrap(dismissHandNote({ home, id: ID, nowIso: JUST_AFTER }));
    rememberLaterPresses({ home, nowIso: JUST_AFTER, open: new Set([ID]), pressed: [ID], prune: true });
    rmSync(join(stateHomePaths({ home }).handNoteDismiss, `${ID}.later`));
  }

  it("reads a Later a reconcile already consumed as dismissed, off the ledger", () => {
    laterConsumed();
    expect(unwrap(noteStanding({ clock: () => LONG_AFTER, home, id: ID }))).toBe("dismissed");
  });

  it("forgets the owner's Later once a raise draws the note again", () => {
    laterConsumed();
    // Past the first note's startup window, so this raise draws rather than keeping a note still starting.
    const raised = raiseHandNote({
      home,
      kindAnswers: NO_KIND_ANSWERS,
      level: "ordinary",
      nowIso: LONG_AFTER,
      run: () => {},
      step: step(),
      whenLive: "keep",
    });
    expect(unwrap(raised).kind).toBe("launched");
    expect(existsSync(join(laterLedgerDir({ home }), ID))).toBe(false);
    const at = new Date(LONG_AFTER);
    utimesSync(join(stateHomePaths({ home }).handSteps, "live", `${ID}.want`), at, at);
    expect(unwrap(noteStanding({ clock: () => "2026-09-29T17:00:00.000Z", home, id: ID }))).toBe("absent");
  });
});
