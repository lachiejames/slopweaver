/**
 * `handover start` against an automatic settle of the same ask, both interleavings, over a real journal and a real
 * row under a temp home this file mints. Each order runs the second writer INSIDE the first one's
 * critical section — the settle's precondition, or the start's refusals — which is exactly the window the closing
 * lock closes. The board sits OUTSIDE `home/handovers`, so the store mirror stays out of it (`testing.md`).
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { acquireClosingLock } from "../../../../../cli/commands/handover/closingLock.js";
import { isContextError, runContext, startRun } from "../../../../../cli/commands/handover/lifecycle.js";
import type { RunContext } from "../../../../../cli/commands/handover/runContextTypes.js";
import type { SettlePrecondition } from "../../../../../cli/commands/handover/settleResidueRun.js";
import { settleAskRow } from "../../../../../cli/commands/handover/settleRowRun.js";
import { startUnderClosingLock } from "../../../../../cli/commands/handover/startUnderLock.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_OK } from "../../../../../cli/exitCodes.js";
import { parseHandoverDoc } from "../../../../../handover/doc.js";
import { appendRunEvent, readRunJournal } from "../../../../../handover/runStore.js";
import { unwrap } from "../../../../../lib/result.js";
import { closureSettlePrecondition } from "../../../../../review/closureRowState.js";
import { stateHomePaths } from "../../../../../stateHome.js";

const SLUG = "close-acme-app-2";
/** A branch that is not the slug, so a lock keyed on the branch would miss the row. */
const BRANCH = "work-on-the-ask";
const PR = "https://github.com/acme/app/pull/2";
const WITNESS = `${PR} closed unmerged at 2026-11-09T00:00:00Z`;
const NOW = "2026-11-10T00:00:00.000Z";

let home = "";
let dir = "";
let path = "";
let runsDir = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "start-settle-"));
  dir = join(home, "board");
  runsDir = stateHomePaths({ home }).runs;
  mkdirSync(dir, { recursive: true });
  mkdirSync(runsDir, { recursive: true });
  path = join(dir, `${SLUG}.md`);
  writeFileSync(
    path,
    [
      "---",
      `slug: ${SLUG}`,
      "kind: ask",
      `summary: "Close ${PR}?"`,
      "status: ready",
      "askedIso: 2026-11-09T00:00:00Z",
      "anchor: transcript:00000000-0000-0000-0000-000000000000#00000000-0000-0000-0000-000000000001",
      "blockedBy: []",
      "artifact: null",
      "doneWhen: []",
      'probeWaiver: "a race fixture asserts the lock, not a behaviour"',
      "---",
      "",
      `# Close ${PR}?`,
      "",
    ].join("\n"),
  );
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** The row resolved as `handover start` resolves it, BEFORE anything else writes. */
const resolved = (): RunContext => {
  const context = runContext({ base: undefined, handoverDir: dir, runsDir, seams: () => [], slug: SLUG });
  if (isContextError(context)) {
    throw new Error(`fixture did not resolve: ${context.message}`);
  }
  return context;
};

/** Start the row over a context read before the call, as a seat would. */
const start = ({ context }: { context: RunContext }): number =>
  startRun({
    all: [context.doc],
    branch: BRANCH,
    context,
    dependencyDone: () => false,
    home,
    nowIso: NOW,
    rerunAllowed: false,
    runsDir,
    writer: undefined,
  });

/** Settle the row the way the landing closure does, with its own precondition. */
const settle = ({ precondition }: { precondition: SettlePrecondition }): Promise<number> =>
  settleAskRow({
    argv: [
      "node",
      "slopweaver",
      "handover",
      "settle",
      SLUG,
      "--as",
      "answered",
      "--witness",
      WITNESS,
      "--lessons",
      "none",
      "--home",
      home,
      "--dir",
      dir,
    ],
    out: () => undefined,
    precondition,
  });

/** Every journal line's kind. */
const kinds = (): readonly string[] => unwrap(readRunJournal({ runsDir, slug: SLUG })).events.map((e) => e.kind);

/** The row's settlement as it reads on disk now. */
const settlement = (): string | undefined => parseHandoverDoc({ path, text: readFileSync(path, "utf8") }).settlement;

describe("handover start under the row's closing lock", () => {
  it("settle first: a start inside the settle's precondition is deferred, and the start after it is refused", async () => {
    const stale = resolved();
    const during: number[] = [];
    const held: (string | undefined)[] = [];
    const code = await settle({
      precondition: (args) => {
        const why = closureSettlePrecondition(args);
        held.push(why);
        during.push(start({ context: stale }));
        return why;
      },
    });
    // Asked once before the card and once over the bytes the write splices (`settleRowWrite.ts`): both inside the lock.
    expect(held).toEqual([undefined, undefined]);
    expect(during).toEqual([EXIT_DEFERRED, EXIT_DEFERRED]);
    expect(code).toBe(EXIT_OK);
    expect(settlement()).toBe("answered");
    expect(kinds()).toEqual([]);
    // The context was read before the settle wrote; only the re-read under the lock sees the settlement.
    expect(stale.doc.settlement).toBe(undefined);
    expect(start({ context: stale })).toBe(EXIT_ERROR);
    expect(kinds()).toEqual([]);
  });

  it("start first: a settle inside the start's refusals is turned away, and the settle after it is held", async () => {
    const context = resolved();
    const asked: RunContext[] = [];
    const attempts: Promise<number>[] = [];
    const contested: boolean[] = [];
    const code = startUnderClosingLock({
      branch: BRANCH,
      context,
      home,
      nowIso: NOW,
      refused: (current) => {
        asked.push(current);
        // The first ask is of the resolved row, before the lock; the second is the critical section under it.
        if (asked.length === 2) {
          // The lock a settle would take, tried directly: the settle's own refusal of it is indistinguishable here
          // from the lessons gate's, so this is the witness that the start holds it.
          const probe = acquireClosingLock({ home, nowIso: NOW, slug: SLUG });
          contested.push(probe.isErr());
          if (probe.isOk()) {
            probe.value.release();
          }
          attempts.push(settle({ precondition: closureSettlePrecondition }));
        }
        return false;
      },
      runsDir,
      writer: undefined,
    });
    expect(code).toBe(EXIT_OK);
    expect(asked.length).toBe(2);
    expect(asked[0]).toBe(context);
    expect(asked[1]).not.toBe(context);
    expect(contested).toEqual([true]);
    expect(await Promise.all(attempts)).toEqual([EXIT_ERROR]);
    expect(kinds()).toEqual(["started"]);
    // The precondition both automatic settlers pass now reads the row as attended. A settle after the start is turned
    // away before it reaches that, by the lessons gate (a started run, no store in this home): the row stays open.
    const row = parseHandoverDoc({ path, text: readFileSync(path, "utf8") });
    expect(closureSettlePrecondition({ doc: row, home })).toBe("its run is active, and that run ends it");
    expect(await settle({ precondition: closureSettlePrecondition })).toBe(EXIT_ERROR);
    expect(settlement()).toBe(undefined);
    expect(kinds()).toEqual(["started"]);
  });

  it("re-reads the journal under the lock: a cycle that finished after the row was resolved is refused", () => {
    const stale = resolved();
    appendRunEvent({ event: { atIso: NOW, branch: SLUG, docHash: "abc", kind: "started" }, runsDir, slug: SLUG });
    appendRunEvent({ event: { atIso: NOW, kind: "finished", residue: [] }, runsDir, slug: SLUG });
    expect(stale.events).toEqual([]);
    expect(start({ context: stale })).toBe(EXIT_ERROR);
    expect(kinds()).toEqual(["started", "finished"]);
  });

  it("defers a startable row while a closer holds the lock, writing nothing, and opens it once let go", () => {
    const context = resolved();
    const held = unwrap(acquireClosingLock({ home, nowIso: NOW, slug: SLUG }));
    expect(start({ context })).toBe(EXIT_DEFERRED);
    expect(kinds()).toEqual([]);
    held.release();
    expect(start({ context })).toBe(EXIT_OK);
    expect(kinds()).toEqual(["started"]);
  });

  it("keeps a refusal's own exit code while a closer holds the lock, rather than deferring a row start refuses", () => {
    writeFileSync(path, readFileSync(path, "utf8").replace("status: ready\n", "status: ready\nsettlement: answered\n"));
    const context = resolved();
    expect(context.doc.settlement).toBe("answered");
    const held = unwrap(acquireClosingLock({ home, nowIso: NOW, slug: SLUG }));
    expect(start({ context })).toBe(EXIT_ERROR);
    held.release();
    expect(kinds()).toEqual([]);
  });
});
