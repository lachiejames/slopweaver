/**
 * `startRun`'s `notDoneReason` precedence — the exact list-vs-start disagreement P1 found: `doc.ts`'s board
 * composer already let a landed-with-`notDoneReason` doc through, but `startRun` refused it unconditionally.
 *
 * Real filesystem fixtures throughout — a temp handovers dir and a temp runs dir — per this repo's zero-mock
 * testing rule; `startRun`'s only side effect (`appendRunEvent`) is a real journal write, so the assertion is
 * "did a new journal line actually get appended", not a mocked call count.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { LessonsReader } from "../../../cli/commands/handover/lessonsGate.js";
import { finishRun, isContextError, runContext, startRun } from "../../../cli/commands/handover/lifecycle.js";
import { blockerRefusal, type DependencyDone, narrowWaiting } from "../../../cli/commands/handover/startGates.js";
import { startOpenedLines } from "../../../cli/commands/handover/startRecap.js";
import { EXIT_OK } from "../../../cli/exitCodes.js";
import { runStateOf } from "../../../handover/ledger.js";
import type { ProbeResult } from "../../../handover/probe.js";
import { appendRunEvent, readRunJournal } from "../../../handover/runStore.js";
import { scanBoard } from "../../../handover/store.js";
import { ok, unwrap } from "../../../lib/result.js";

/**
 * The lesson gate reading a register that holds nothing for this run.
 *
 * A plain function passed in, not a mock: `.claude/rules/testing.md` bans those, and the gate takes this
 * seam precisely so a unit test can reach its branches without a database. What a connected store does with
 * it is proven against a real Postgres (`docs/store.md`), never faked here.
 */
const NO_LESSONS_RECORDED: LessonsReader = () => Promise.resolve(ok([]));

/** The board composer reading no dependency as satisfied — the authored reading alone decides. */
const NO_DEPENDENCY_DONE: DependencyDone = () => false;

const cleanups: (() => void)[] = [];

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => {
    cleanup();
  });
});

/** A temp handovers dir holding one doc, plus an empty runs dir alongside it. */
function fixture({ frontMatter }: { frontMatter: string }): {
  handoverDir: string;
  runsDir: string;
  slug: string;
  home: string;
} {
  const root = mkdtempSync(join(tmpdir(), "slopweaver-lifecycle-"));
  const handoverDir = join(root, "handovers");
  const runsDir = join(root, "runs");
  const slug = "multi-slice";
  mkdirSync(handoverDir, { recursive: true });
  mkdirSync(runsDir, { recursive: true });
  writeFileSync(join(handoverDir, `${slug}.md`), `---\nslug: ${slug}\n${frontMatter}\n---\n# doc\n`);
  cleanups.push(() => {
    rmSync(root, { force: true, recursive: true });
  });
  return { handoverDir, home: root, runsDir, slug };
}

const LANDED_SEAMS = (): readonly ProbeResult[] => [
  { note: "slice one exists", outcome: "pass", probe: { file: "a.ts", kind: "present", symbol: "x" } },
];

describe("startRun agrees with the board on notDoneReason", () => {
  it("allows starting a never-started doc whose landed slice-one probes carry a notDoneReason", () => {
    const { handoverDir, runsDir, slug } = fixture({
      frontMatter: "status: ready\nnotDoneReason: only slice one is probed",
    });
    const context = runContext({ base: undefined, handoverDir, runsDir, seams: LANDED_SEAMS, slug });
    expect(isContextError(context)).toBe(false);
    if (isContextError(context)) {
      return;
    }
    const code = startRun({
      all: [context.doc],
      branch: "work",
      context,
      dependencyDone: NO_DEPENDENCY_DONE,
      home: dirname(runsDir),
      nowIso: "2026-08-20T00:00:00.000Z",
      rerunAllowed: false,
      runsDir,
      writer: undefined,
    });
    expect(code).toBe(EXIT_OK);
    expect(readFileSync(join(runsDir, `${slug}.jsonl`), "utf8")).toContain('"kind":"started"');
  });

  it("refuses starting a doc whose probes land with no notDoneReason — the ordinary LOOKS SHIPPED case", () => {
    const { handoverDir, runsDir, slug } = fixture({ frontMatter: "status: ready" });
    const context = runContext({ base: undefined, handoverDir, runsDir, seams: LANDED_SEAMS, slug });
    expect(isContextError(context)).toBe(false);
    if (isContextError(context)) {
      return;
    }
    const code = startRun({
      all: [context.doc],
      branch: "work",
      context,
      dependencyDone: NO_DEPENDENCY_DONE,
      home: dirname(runsDir),
      nowIso: "2026-08-20T00:00:00.000Z",
      rerunAllowed: false,
      runsDir,
      writer: undefined,
    });
    expect(code).not.toBe(EXIT_OK);
  });

  it("refuses starting a doc whose PRIOR cycle actually finished, even with a stale notDoneReason", () => {
    const { handoverDir, runsDir, slug } = fixture({
      frontMatter: "status: ready\nnotDoneReason: stale — written before the run happened",
    });
    appendRunEvent({
      event: { atIso: "2026-08-19T00:00:00.000Z", branch: "work", docHash: "abc", kind: "started" },
      runsDir,
      slug,
    });
    appendRunEvent({ event: { atIso: "2026-08-19T01:00:00.000Z", kind: "finished", residue: [] }, runsDir, slug });
    const context = runContext({ base: undefined, handoverDir, runsDir, seams: LANDED_SEAMS, slug });
    expect(isContextError(context)).toBe(false);
    if (isContextError(context)) {
      return;
    }
    const code = startRun({
      all: [context.doc],
      branch: "work",
      context,
      dependencyDone: NO_DEPENDENCY_DONE,
      home: dirname(runsDir),
      nowIso: "2026-08-20T00:00:00.000Z",
      rerunAllowed: false,
      runsDir,
      writer: undefined,
    });
    expect(code).not.toBe(EXIT_OK);
  });
});

describe("startRun over a cycle waiting on the owner", () => {
  it("opens the new cycle WAITING on the same question when a peer starts over it with no ending recorded", () => {
    const { handoverDir, runsDir, slug } = fixture({
      frontMatter: 'status: ready\nprobeWaiver: "a lifecycle fixture asserts the carried question, not a behaviour"',
    });
    appendRunEvent({
      event: { atIso: "2026-10-01T00:00:00.000Z", branch: "work", docHash: "abc", kind: "started" },
      runsDir,
      slug,
    });
    appendRunEvent({
      event: { atIso: "2026-10-01T01:00:00.000Z", kind: "question", question: "which base?" },
      runsDir,
      slug,
    });
    const context = runContext({ base: undefined, handoverDir, runsDir, seams: () => [], slug });
    expect(isContextError(context)).toBe(false);
    if (isContextError(context)) {
      return;
    }

    const code = startRun({
      all: [context.doc],
      branch: "work",
      context,
      dependencyDone: NO_DEPENDENCY_DONE,
      home: dirname(runsDir),
      nowIso: "2026-10-02T03:36:12.719Z",
      rerunAllowed: false,
      runsDir,
      writer: undefined,
    });

    expect(code).toBe(EXIT_OK);
    const state = runStateOf({ events: unwrap(readRunJournal({ runsDir, slug })).events });
    expect(state.entries).toBe(1);
    expect(state.phase).toBe("waiting-on-owner");
    expect(state.openQuestion).toBe("which base?");
  });
});

describe("finishRun --dry-run — previews the close without writing it", () => {
  it("passes every gate, prints the would-be event, exits OK, and appends NOTHING to the journal", async () => {
    // The waiver is what makes this doc closable at all: since the behavioural-probe trigger became
    // unconditional, a doc with neither a probe nor a waiver is refused whatever its summary says.
    const { handoverDir, home, runsDir, slug } = fixture({
      frontMatter: 'status: ready\nprobeWaiver: "a lifecycle fixture asserts the dry run, not a behaviour"',
    });
    const opened = runContext({ base: undefined, handoverDir, runsDir, seams: () => [], slug });
    expect(isContextError(opened)).toBe(false);
    if (isContextError(opened)) {
      return;
    }
    expect(
      startRun({
        all: [opened.doc],
        branch: "work",
        context: opened,
        dependencyDone: NO_DEPENDENCY_DONE,
        home: dirname(runsDir),
        nowIso: "2026-08-28T00:00:00.000Z",
        rerunAllowed: false,
        runsDir,
        writer: undefined,
      }),
    ).toBe(EXIT_OK);
    const journalPath = join(runsDir, `${slug}.jsonl`);
    const journalBeforeDryRun = readFileSync(journalPath, "utf8");

    const openRun = runContext({ base: undefined, handoverDir, runsDir, seams: () => [], slug });
    expect(isContextError(openRun)).toBe(false);
    if (isContextError(openRun)) {
      return;
    }
    const code = await finishRun({
      context: openRun,
      dryRun: true,
      forced: false,
      home,
      lessons: "none",
      mode: "refuse",
      nowIso: "2026-08-28T01:00:00.000Z",
      readLessons: NO_LESSONS_RECORDED,
      runsDir,
      structuralAllowed: false,
    });

    expect(code).toBe(EXIT_OK);
    expect(readFileSync(journalPath, "utf8")).toBe(journalBeforeDryRun);

    const stillOpen = runContext({ base: undefined, handoverDir, runsDir, seams: () => [], slug });
    expect(isContextError(stillOpen)).toBe(false);
    if (isContextError(stillOpen)) {
      return;
    }
    expect(stillOpen.run.phase).toBe("open");
  });
  it("refuses a doc quoting nobody that carries neither a probe nor a waiver", async () => {
    const { handoverDir, home, runsDir, slug } = fixture({
      frontMatter: "status: ready\nsummary: tidy up the lexical index build",
    });
    const opened = runContext({ base: undefined, handoverDir, runsDir, seams: () => [], slug });
    expect(isContextError(opened)).toBe(false);
    if (isContextError(opened)) {
      return;
    }
    expect(
      startRun({
        all: [opened.doc],
        branch: "work",
        context: opened,
        dependencyDone: NO_DEPENDENCY_DONE,
        home: dirname(runsDir),
        nowIso: "2026-09-01T00:00:00.000Z",
        rerunAllowed: false,
        runsDir,
        writer: undefined,
      }),
    ).toBe(EXIT_OK);

    const openRun = runContext({ base: undefined, handoverDir, runsDir, seams: () => [], slug });
    expect(isContextError(openRun)).toBe(false);
    if (isContextError(openRun)) {
      return;
    }

    expect(
      await finishRun({
        context: openRun,
        dryRun: false,
        forced: false,
        home,
        lessons: "none",
        mode: "refuse",
        nowIso: "2026-09-01T01:00:00.000Z",
        readLessons: NO_LESSONS_RECORDED,
        runsDir,
        structuralAllowed: false,
      }),
    ).not.toBe(EXIT_OK);
  });
});

describe("startOpenedLines", () => {
  const NO_PROBES = (): readonly ProbeResult[] => [];

  it("carries the doc's summary and a self-executing NEXT line even with 0 declared probes", () => {
    const { handoverDir, runsDir, slug } = fixture({
      frontMatter: "status: ready\nsummary: dispatched sessions must read the doc, never ask what it covers",
    });
    const context = runContext({ base: undefined, handoverDir, runsDir, seams: NO_PROBES, slug });
    expect(isContextError(context)).toBe(false);
    if (isContextError(context)) {
      return;
    }

    const lines = startOpenedLines({
      branch: "work",
      doc: context.doc,
      inheritedQuestion: undefined,
      journalPath: join(runsDir, `${slug}.jsonl`),
      results: context.results,
    });

    expect(lines).toContain("  summary: dispatched sessions must read the doc, never ask what it covers");
    expect(lines).toContain(
      `  NEXT: read the doc at ${context.doc.path} in full and execute it. 0 probes means probes are ` +
        "unregistered — register real doneWhen probes as soon as the work's shape is known. Never ask the owner " +
        "what this run covers.",
    );
    expect(lines[0]).toBe(`handover start: opened a run for ${slug} on work`);
  });

  it("opens WAITING and prints the inherited question instead of telling the session to execute the doc", () => {
    const { handoverDir, runsDir, slug } = fixture({ frontMatter: "status: ready" });
    const context = runContext({ base: undefined, handoverDir, runsDir, seams: NO_PROBES, slug });
    expect(isContextError(context)).toBe(false);
    if (isContextError(context)) {
      return;
    }

    const lines = startOpenedLines({
      branch: "work",
      doc: context.doc,
      inheritedQuestion: "three calls?",
      journalPath: join(runsDir, `${slug}.jsonl`),
      results: context.results,
    });

    expect(lines[0]).toBe(`handover start: opened a run for ${slug} on work, WAITING ON THE OWNER`);
    expect(lines).toContain("    three calls?");
    expect(lines).toContain(
      "  NEXT: the previous cycle closed holding an unanswered question, and neither a dead session nor a " +
        "re-start is an answer. Do not proceed — the question is:",
    );
    expect(lines.some((line) => line.includes("read the doc"))).toBe(false);
  });

  it("omits the summary line entirely when the doc names none", () => {
    const { handoverDir, runsDir, slug } = fixture({ frontMatter: "status: ready" });
    const context = runContext({ base: undefined, handoverDir, runsDir, seams: NO_PROBES, slug });
    expect(isContextError(context)).toBe(false);
    if (isContextError(context)) {
      return;
    }

    const lines = startOpenedLines({
      branch: "work",
      doc: context.doc,
      inheritedQuestion: undefined,
      journalPath: join(runsDir, `${slug}.jsonl`),
      results: context.results,
    });

    expect(lines.some((line) => line.startsWith("  summary:"))).toBe(false);
  });
});

/**
 * The finished-cycle door, exercised through the real `startRun` over a real journal.
 *
 * The probes are deliberately EMPTY here, which is the whole point: `landedRefusal` fires only when every
 * declared probe currently passes, so a doc with none reaches this gate and nothing else. That is the shape
 * of the 78 measured rows — a run closed with a waived, failing or absent probe, its `status:` still `ready`.
 */
describe("startRun refuses a cycle the journal already closed", () => {
  /** Open a run context, throwing rather than branching — no conditional may sit between a test and its claim. */
  function open({ handoverDir, runsDir, slug }: { handoverDir: string; runsDir: string; slug: string }) {
    const context = runContext({ base: undefined, handoverDir, runsDir, seams: () => [], slug });
    if (isContextError(context)) {
      throw new Error(`fixture did not resolve: ${context.message}`);
    }
    return context;
  }

  /** Journal one complete cycle: opened, then closed with no residue. */
  function journalFinishedCycle({ runsDir, slug }: { runsDir: string; slug: string }): void {
    appendRunEvent({
      event: { atIso: "2026-09-01T08:00:00.000Z", branch: "work", docHash: "abc", kind: "started" },
      runsDir,
      slug,
    });
    appendRunEvent({ event: { atIso: "2026-09-01T09:00:41.052Z", kind: "finished", residue: [] }, runsDir, slug });
  }

  const READY = 'status: ready\nprobeWaiver: "the outcome was a measurement, so no static probe asserts it"';

  it("starts a doc whose journal is empty — the witness this gate can be absent", () => {
    const { handoverDir, runsDir, slug } = fixture({ frontMatter: READY });
    const code = startRun({
      all: [],
      branch: "work",
      context: open({ handoverDir, runsDir, slug }),
      dependencyDone: NO_DEPENDENCY_DONE,
      home: dirname(runsDir),
      nowIso: "2026-09-04T07:30:00.000Z",
      rerunAllowed: false,
      runsDir,
      writer: undefined,
    });
    expect(code).toBe(EXIT_OK);
  });

  it("refuses the same start once the journal carries a finished cycle, with status still reading ready", () => {
    const { handoverDir, runsDir, slug } = fixture({ frontMatter: READY });
    journalFinishedCycle({ runsDir, slug });
    const context = open({ handoverDir, runsDir, slug });
    expect(context.doc.status).toBe("ready");
    const code = startRun({
      all: [],
      branch: "work",
      context,
      dependencyDone: NO_DEPENDENCY_DONE,
      home: dirname(runsDir),
      nowIso: "2026-09-04T07:30:00.000Z",
      rerunAllowed: false,
      runsDir,
      writer: undefined,
    });
    expect(code).not.toBe(EXIT_OK);
    expect(
      readFileSync(join(runsDir, `${slug}.jsonl`), "utf8")
        .split("\n")
        .filter(Boolean).length,
    ).toBe(2);
  });

  it("re-opens the finished cycle when the break-glass is set", () => {
    const { handoverDir, runsDir, slug } = fixture({ frontMatter: READY });
    journalFinishedCycle({ runsDir, slug });
    const code = startRun({
      all: [],
      branch: "work",
      context: open({ handoverDir, runsDir, slug }),
      dependencyDone: NO_DEPENDENCY_DONE,
      home: dirname(runsDir),
      nowIso: "2026-09-04T07:30:00.000Z",
      rerunAllowed: true,
      runsDir,
      writer: undefined,
    });
    expect(code).toBe(EXIT_OK);
    expect(
      readFileSync(join(runsDir, `${slug}.jsonl`), "utf8")
        .split("\n")
        .filter(Boolean).length,
    ).toBe(3);
  });
});

/**
 * `start` reads a dependency as the board composer does. A row ended by `handover close` keeps its authored
 * `status: ready`, so `blockerFor` alone answers `waiting` on it while `handover list` places the dependent under
 * `RUN NOW` — measured on a live board, where the verb refused a row its own `handover row` printed as runnable.
 */
describe("startRun narrows a waiting blocker to what the board composer does not read as done", () => {
  const DEPENDENT = 'status: ready\nblockedBy: [closed-dep]\nprobeWaiver: "a fixture asserts the dependency read"';

  /** A fixture's dirs and slug as `runContext` takes them, with no probe evaluated. */
  function within({ paths }: { paths: { handoverDir: string; runsDir: string; slug: string } }) {
    return { handoverDir: paths.handoverDir, runsDir: paths.runsDir, seams: () => [], slug: paths.slug };
  }

  /** The dependent doc plus a `closed-dep` doc whose authored status is still `ready`, and the board over both. */
  function boardWithReadyDependency() {
    const paths = fixture({ frontMatter: DEPENDENT });
    writeFileSync(join(paths.handoverDir, "closed-dep.md"), "---\nslug: closed-dep\nstatus: ready\n---\n# dep\n");
    const context = runContext({ base: undefined, ...within({ paths }) });
    if (isContextError(context)) {
      throw new Error(`fixture did not resolve: ${context.message}`);
    }
    const all = unwrap(scanBoard({ handoverDir: paths.handoverDir })).docs;
    return { all, context, ...paths };
  }

  it("opens the run when the composer reads the authored-ready dependency as satisfied", () => {
    const { all, context, runsDir, slug } = boardWithReadyDependency();
    expect(all.find((doc) => doc.slug === "closed-dep")!.status).toBe("ready");
    const code = startRun({
      all,
      branch: "work",
      context,
      dependencyDone: ({ slug: dependency }) => dependency === "closed-dep",
      home: dirname(runsDir),
      nowIso: "2026-10-31T00:00:00.000Z",
      rerunAllowed: false,
      runsDir,
      writer: undefined,
    });
    expect(code).toBe(EXIT_OK);
    expect(readFileSync(join(runsDir, `${slug}.jsonl`), "utf8")).toContain('"kind":"started"');
  });

  it("still refuses, writing nothing, when the composer does not read the dependency as satisfied", () => {
    const { all, context, runsDir, slug } = boardWithReadyDependency();
    const code = startRun({
      all,
      branch: "work",
      context,
      dependencyDone: NO_DEPENDENCY_DONE,
      home: dirname(runsDir),
      nowIso: "2026-10-31T00:00:00.000Z",
      rerunAllowed: false,
      runsDir,
      writer: undefined,
    });
    expect(code).not.toBe(EXIT_OK);
    expect(existsSync(join(runsDir, `${slug}.jsonl`))).toBe(false);
  });

  it("names only the dependency still waited on when the composer reads one of two as done", () => {
    const paths = fixture({
      frontMatter: 'status: ready\nblockedBy: [closed-dep, open-dep]\nprobeWaiver: "a fixture asserts the read"',
    });
    writeFileSync(join(paths.handoverDir, "closed-dep.md"), "---\nslug: closed-dep\nstatus: ready\n---\n# dep\n");
    writeFileSync(join(paths.handoverDir, "open-dep.md"), "---\nslug: open-dep\nstatus: ready\n---\n# dep\n");
    const context = runContext({ base: undefined, ...within({ paths }) });
    if (isContextError(context)) {
      throw new Error(`fixture did not resolve: ${context.message}`);
    }
    expect(
      blockerRefusal({
        all: unwrap(scanBoard({ handoverDir: paths.handoverDir })).docs,
        context,
        dependencyDone: ({ slug }) => slug === "closed-dep",
      }),
    ).toBe("handover start: multi-slice is not startable — waiting on open-dep");
  });

  it("never asks the composer about a dependency no doc on the board claims", () => {
    const paths = fixture({ frontMatter: 'status: ready\nblockedBy: [nowhere]\nprobeWaiver: "a fixture"' });
    const context = runContext({ base: undefined, ...within({ paths }) });
    if (isContextError(context)) {
      throw new Error(`fixture did not resolve: ${context.message}`);
    }
    const asked: string[] = [];
    const refusal = blockerRefusal({
      all: unwrap(scanBoard({ handoverDir: paths.handoverDir })).docs,
      context,
      dependencyDone: ({ slug }) => {
        asked.push(slug);
        return true;
      },
    });
    expect(refusal).toBe("handover start: multi-slice is not startable — missing-dependency");
    expect(asked).toEqual([]);
  });
});

describe("narrowWaiting", () => {
  it("keeps only the slugs the composer does not read as done", () => {
    expect(
      narrowWaiting({
        blocker: { kind: "waiting", on: ["a", "b", "c"] },
        dependencyDone: ({ slug }) => slug === "b",
      }),
    ).toEqual({ kind: "waiting", on: ["a", "c"] });
  });

  it("answers no blocker once every waited-on slug reads done", () => {
    expect(narrowWaiting({ blocker: { kind: "waiting", on: ["a"] }, dependencyDone: () => true })).toBe(undefined);
  });

  it("passes every other blocker through untouched, even when the composer would call everything done", () => {
    expect(narrowWaiting({ blocker: { kind: "missing-dependency", on: ["a"] }, dependencyDone: () => true })).toEqual({
      kind: "missing-dependency",
      on: ["a"],
    });
  });

  it("passes no blocker through as no blocker", () => {
    expect(narrowWaiting({ blocker: undefined, dependencyDone: () => true })).toBe(undefined);
  });
});
