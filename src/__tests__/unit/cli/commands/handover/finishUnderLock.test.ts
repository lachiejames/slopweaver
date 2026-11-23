/**
 * `handover finish`'s closing stretch holds the row's closing lock: a settle, finish or `page publish` already
 * holding it refuses this close, and the close proceeds once it is let go. A page made the artifact between
 * finish's page-gate read and its write would close the row uncarded.
 *
 * Real filesystem fixtures — a temp handovers dir and runs dir — and the real journal.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { acquireClosingLock } from "../../../../../cli/commands/handover/closingLock.js";
import { finishUnderClosingLock } from "../../../../../cli/commands/handover/finishUnderLock.js";
import { isContextError, runContext, startRun } from "../../../../../cli/commands/handover/lifecycle.js";
import { type RunContext } from "../../../../../cli/commands/handover/runContextTypes.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../cli/exitCodes.js";
import { runStateOf } from "../../../../../handover/ledger.js";
import { readRunJournal } from "../../../../../handover/runStore.js";
import { unwrap } from "../../../../../lib/result.js";

const SLUG = "closing-lock";
const roots: string[] = [];

afterEach(() => {
  roots.splice(0).forEach((root) => {
    rmSync(root, { force: true, recursive: true });
  });
});

/** A temp home with one waived doc and an empty runs dir beside it. */
function fixture(): { handoverDir: string; home: string; runsDir: string } {
  const home = mkdtempSync(join(tmpdir(), "finish-under-lock-"));
  roots.push(home);
  const handoverDir = join(home, "handovers");
  const runsDir = join(home, "runs");
  mkdirSync(handoverDir, { recursive: true });
  mkdirSync(runsDir, { recursive: true });
  writeFileSync(
    join(handoverDir, `${SLUG}.md`),
    `---\nslug: ${SLUG}\nstatus: ready\nprobeWaiver: "a fixture asserting the closing lock, not a behaviour"\n---\n# doc\n`,
  );
  return { handoverDir, home, runsDir };
}

/** The doc's run context, which the fixture guarantees resolves. */
function contextOf({ handoverDir, runsDir }: { handoverDir: string; runsDir: string }): RunContext {
  const context = runContext({ base: undefined, handoverDir, runsDir, seams: () => [], slug: SLUG });
  if (isContextError(context)) {
    throw new Error(`the fixture's doc did not resolve: ${JSON.stringify(context)}`);
  }
  return context;
}

/** The run's phase, read back off its journal. */
function phaseOf({ runsDir }: { runsDir: string }): string {
  return runStateOf({ events: unwrap(readRunJournal({ runsDir, slug: SLUG })).events }).phase;
}

/** Open the fixture's run, as `handover start` would. */
function started({ handoverDir, home, runsDir }: { handoverDir: string; home: string; runsDir: string }): void {
  const fresh = contextOf({ handoverDir, runsDir });
  startRun({
    all: [fresh.doc],
    branch: "work",
    context: fresh,
    dependencyDone: () => false,
    home,
    nowIso: "2026-11-03T00:00:00.000Z",
    rerunAllowed: false,
    runsDir,
    writer: undefined,
  });
}

/** Every journal line's kind, with a `lessons` line's `forced` flag beside it. */
function journalShape({ runsDir }: { runsDir: string }): readonly string[] {
  return unwrap(readRunJournal({ runsDir, slug: SLUG })).events.map((event) =>
    event.kind === "lessons" ? `lessons forced=${String(event.forced)}` : event.kind,
  );
}

describe("finishUnderClosingLock", () => {
  // The wake's reconcile counts a forced lesson line as an answer, so one journalled on a close that then refuses
  // spends the question on a run still owing work.
  it("journals a deferred forced lesson only once the close goes through, never on a close that refuses", () => {
    const { handoverDir, home, runsDir } = fixture();
    started({ handoverDir, home, runsDir });
    const finish = (): number =>
      finishUnderClosingLock({
        context: contextOf({ handoverDir, runsDir }),
        dryRun: false,
        forced: false,
        forcedLessons: true,
        home,
        mode: "refuse",
        nowIso: "2026-11-03T01:00:00.000Z",
        park: undefined,
        readPageReach: undefined,
        runsDir,
        structuralAllowed: false,
      });
    const held = unwrap(acquireClosingLock({ home, nowIso: "2026-11-03T00:30:00.000Z", slug: SLUG }));
    expect(finish()).toBe(EXIT_ERROR);
    expect(journalShape({ runsDir })).toEqual(["started"]);
    held.release();
    expect(finish()).toBe(EXIT_OK);
    expect(journalShape({ runsDir })).toEqual(["started", "finished", "lessons forced=true"]);
  });

  it("refuses while another closer or a page publish holds the row's closing lock, and closes once it is let go", () => {
    const { handoverDir, home, runsDir } = fixture();
    started({ handoverDir, home, runsDir });
    const finish = (): number =>
      finishUnderClosingLock({
        context: contextOf({ handoverDir, runsDir }),
        dryRun: false,
        forced: false,
        forcedLessons: false,
        home,
        mode: "refuse",
        nowIso: "2026-11-03T01:00:00.000Z",
        park: undefined,
        readPageReach: undefined,
        runsDir,
        structuralAllowed: false,
      });
    const held = unwrap(acquireClosingLock({ home, nowIso: "2026-11-03T00:30:00.000Z", slug: SLUG }));
    expect(finish()).toBe(EXIT_ERROR);
    expect(phaseOf({ runsDir })).toBe("open");
    held.release();
    expect(finish()).toBe(EXIT_OK);
    expect(phaseOf({ runsDir })).toBe("closed");
  });
});
