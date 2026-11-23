/**
 * `finishRun`'s `besideQuestion`: the readiness preview `handover wake` asks before suspending a merged park, which
 * runs every finish gate but the owner-wait one — on a dry run only, so a real finish never closes a run whose
 * question is still open. Real temp handovers and runs dirs, as in `lifecycle.test.ts` beside it.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { LessonsReader } from "../../../cli/commands/handover/lessonsGate.js";
import { finishRun, isContextError, runContext } from "../../../cli/commands/handover/lifecycle.js";
import { EXIT_OK } from "../../../cli/exitCodes.js";
import { appendRunEvent } from "../../../handover/runStore.js";
import { ok } from "../../../lib/result.js";

/** The lesson gate reading a register that holds nothing for this run: a plain seam, not a mock. */
const NO_LESSONS_RECORDED: LessonsReader = () => Promise.resolve(ok([]));

const SLUG = "multi-slice";
const cleanups: (() => void)[] = [];

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => {
    cleanup();
  });
});

/** A started run carrying an open question, opened as `finish` reads it, plus a read of its journal's bytes. */
function waitingRun(): {
  context: Parameters<typeof finishRun>[0]["context"];
  home: string;
  journal: () => string;
  runsDir: string;
} {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-beside-"));
  cleanups.push(() => {
    rmSync(home, { force: true, recursive: true });
  });
  const handoverDir = join(home, "handovers");
  const runsDir = join(home, "runs");
  mkdirSync(handoverDir, { recursive: true });
  mkdirSync(runsDir, { recursive: true });
  const waiver = 'probeWaiver: "a lifecycle fixture asserts the owner-wait gate, not a behaviour"';
  writeFileSync(join(handoverDir, `${SLUG}.md`), `---\nslug: ${SLUG}\nstatus: ready\n${waiver}\n---\n# doc\n`);
  appendRunEvent({
    event: { atIso: "2026-11-01T00:00:00.000Z", branch: "work", docHash: "abc", kind: "started" },
    runsDir,
    slug: SLUG,
  });
  appendRunEvent({
    event: { atIso: "2026-11-01T01:00:00.000Z", kind: "question", question: "which base?" },
    runsDir,
    slug: SLUG,
  });
  const context = runContext({ base: undefined, handoverDir, runsDir, seams: () => [], slug: SLUG });
  if (isContextError(context)) {
    throw new Error("the waiting run did not open");
  }
  expect(context.run.phase).toBe("waiting-on-owner");
  return { context, home, journal: () => readFileSync(join(runsDir, `${SLUG}.jsonl`), "utf8"), runsDir };
}

/** One finish over that run: a dry run or not, the question set aside or not. */
async function finishWaiting({ besideQuestion, dryRun }: { besideQuestion: boolean; dryRun: boolean }): Promise<{
  code: number;
  journalUnchanged: boolean;
}> {
  const { context, home, journal, runsDir } = waitingRun();
  const before = journal();
  const code = await finishRun({
    besideQuestion,
    context,
    dryRun,
    forced: false,
    home,
    lessons: "none",
    mode: "refuse",
    nowIso: "2026-11-01T02:00:00.000Z",
    readLessons: NO_LESSONS_RECORDED,
    runsDir,
    structuralAllowed: false,
  });
  return { code, journalUnchanged: journal() === before };
}

describe("finishRun --beside-question — a readiness preview over a run waiting on the owner", () => {
  it("passes every gate on a dry run with the question set aside, and writes nothing", async () => {
    expect(await finishWaiting({ besideQuestion: true, dryRun: true })).toEqual({
      code: EXIT_OK,
      journalUnchanged: true,
    });
  });

  it("still refuses a dry run that does not set the question aside", async () => {
    const { code, journalUnchanged } = await finishWaiting({ besideQuestion: false, dryRun: true });
    expect(code).not.toBe(EXIT_OK);
    expect(journalUnchanged).toBe(true);
  });

  it("never sets the question aside on a real finish", async () => {
    const { code, journalUnchanged } = await finishWaiting({ besideQuestion: true, dryRun: false });
    expect(code).not.toBe(EXIT_OK);
    expect(journalUnchanged).toBe(true);
  });
});
