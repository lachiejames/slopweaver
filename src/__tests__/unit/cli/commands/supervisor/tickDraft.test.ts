/**
 * `slopweaver supervisor tick-draft` end to end over injected seams, and the draft it writes fed straight
 * into `supervisor tick-record` — the round trip is the point of the verb, so it is the test.
 *
 * The seams are plain functions passed in, not mocks: the filesystem is one table, the writes are one array.
 */
import { describe, expect, it } from "vitest";

import type { ChairGateEvidence } from "../../../../../cli/commands/supervisor/chairGateRun.js";
import { SupervisorErrors } from "../../../../../cli/commands/supervisor/errors.js";
import { parseSupervisorTickDraftArgs } from "../../../../../cli/commands/supervisor/tickDraftCore.js";
import {
  draftFileText,
  runSupervisorTickDraft,
  type SupervisorTickDraftDeps,
} from "../../../../../cli/commands/supervisor/tickDraftRun.js";
import { runSupervisorTickRecord } from "../../../../../cli/commands/supervisor/tickRecordRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { SupervisorTickRow } from "../../../../../supervisor/tickTypes.js";

const STARTED = "2026-09-12T21:18:42.000Z";
const CAPTURED = "2026-09-12T21:25:00.000Z";

/** A tick the chair gate read nothing for — these cases are about the recorder, not the cadence. */
const NOT_READ: ChairGateEvidence = { kind: "not-read", why: "this fixture exercises the recorder" };

/** The flags every run needs, before the ones a case adds. */
const REQUIRED: readonly string[] = [
  "--tick-id",
  "handoff-9249-tick-7",
  "--workspace",
  "workspace:55",
  "--handoff",
  "handoff-9249",
  "--started",
  STARTED,
  "--captured",
  CAPTURED,
  "--actions",
  "actions.json",
  "--judgements",
  "judgements.json",
];

/** One action, in the shape the tick schema takes. */
const ACTIONS = JSON.stringify([
  {
    actionId: "h249-t7-a1",
    kind: "answered",
    outcome: "completed",
    recordedIso: "2026-09-12T21:26:31.000Z",
    subject: { id: "owner-turn-249-3", kind: "owner-turn", label: "the no-python rule" },
    witness: { kind: "command", ref: "owner-turn-249-3.txt" },
  },
]);

/** A capacity document, the one source these cases supply. */
const CAPACITY = JSON.stringify({
  dispatch: { backoffSeconds: 0, covering: 0, open: 0, subject: "" },
  hold: true,
  holdSubjects: ["cpu"],
  load: { load1: 30.93 },
  segmentsPct: 15,
  swapfileCount: 5,
  topForeign: { footprintGb: 5.2, label: "mds" },
  verdict: "machine capacity: HOLD on cpu",
});

/** A reconciliation carrying one owner turn, for the round trip through tick-record. */
const RECONCILE = JSON.stringify({
  intake: {
    finding: {
      coverage: { linksKnown: 1, reachesSince: true, unreadable: [], walked: ["a1"] },
      sinceIso: "2026-09-11T21:00:00.000Z",
      turns: [
        {
          inGrace: false,
          turn: {
            lineNumber: 1654,
            pointer: "transcript:a1#t1",
            sessionId: "a1",
            source: "typed",
            text: "a new general rule should be: if you had to do something with python…",
            timestamp: "2026-09-12T21:24:52.000Z",
            turnUuid: "t1",
          },
          witness: { kind: "row", witness: "no-python-anything-done-in-python-is-done-in-typescript" },
        },
      ],
    },
    kind: "read",
  },
});

/** What one run produced. */
interface Capture {
  readonly out: string[];
  readonly diagnostics: string[];
  readonly written: { path: string; text: string }[];
  readonly deps: SupervisorTickDraftDeps;
}

/**
 * Build the injected seams over a fixed file table.
 *
 * @param files the path-to-contents table the verb reads from
 * @returns the capture, with the deps to pass in
 */
function capture({ files }: { files: Readonly<Record<string, string>> }): Capture {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const written: { path: string; text: string }[] = [];
  return {
    deps: {
      readFile: ({ path }) => {
        const content = files[path];
        if (content === undefined) {
          throw new Error(`${path}: no such file`);
        }
        return content;
      },
      writeDiagnostic: (line) => diagnostics.push(line),
      writeFile: ({ path, text }) => written.push({ path, text }),
      writeOut: (line) => out.push(line),
    },
    diagnostics,
    out,
    written,
  };
}

/** The file table every happy case reads from. */
const FILES: Readonly<Record<string, string>> = {
  "actions.json": ACTIONS,
  "capacity.json": CAPACITY,
  "judgements.json": "[]",
};

describe("parseSupervisorTickDraftArgs", () => {
  it("names every required flag that was not given", () => {
    const refusal = unwrapErr(parseSupervisorTickDraftArgs({ rest: [] }));

    expect(refusal.length).toBe(8);
    expect(refusal[0]).toBe("--tick-id is required");
  });

  it("refuses an output that is also an input", () => {
    const refusal = unwrapErr(
      parseSupervisorTickDraftArgs({ rest: [...REQUIRED, "--capacity", "capacity.json", "--out", "capacity.json"] }),
    );

    expect(refusal).toStrictEqual([
      "--out capacity.json is also an input: writing the draft would overwrite what it was read from",
    ]);
  });

  it("refuses --json beside --out -, which already owns stdout", () => {
    const refusal = unwrapErr(parseSupervisorTickDraftArgs({ rest: [...REQUIRED, "--out", "-", "--json"] }));

    expect(refusal).toStrictEqual(["--json cannot be combined with --out -: stdout already carries the draft itself"]);
  });

  it("refuses a capture instant before the tick started", () => {
    const refusal = unwrapErr(
      parseSupervisorTickDraftArgs({
        rest: [...REQUIRED.slice(0, 9), "2026-09-12T20:00:00.000Z", ...REQUIRED.slice(10), "--out", "draft.json"],
      }),
    );

    expect(refusal).toStrictEqual([`--captured 2026-09-12T20:00:00.000Z is before --started ${STARTED}`]);
  });
});

describe("runSupervisorTickDraft", () => {
  it("writes the draft and says which sources it read, left partial and could not record", () => {
    const run = capture({ files: FILES });
    const code = runSupervisorTickDraft({
      deps: run.deps,
      rest: [...REQUIRED, "--capacity", "capacity.json", "--out", "draft.json"],
    });

    expect(code).toBe(EXIT_OK);
    expect(run.written.length).toBe(1);
    expect(run.written[0]!.path).toBe("draft.json");
    expect(run.out[0]!).toBe(
      "supervisor tick-draft: wrote draft.json — 1 read, 0 partial (none), 11 unavailable " +
        "(gauge, listener, reconcile, watch, closeDone, depth, recipeDue, velocity, friction, github, landings); " +
        `checked against the tick ledger at ${CAPTURED}`,
    );
  });

  it("prints only the draft to stdout under --out -", () => {
    const run = capture({ files: FILES });
    const code = runSupervisorTickDraft({ deps: run.deps, rest: [...REQUIRED, "--out", "-"] });
    const document = JSON.parse(run.out[0]!) as { tickId: string; sources: Record<string, { status: string }> };

    expect(code).toBe(EXIT_OK);
    expect(run.out.length).toBe(1);
    expect(run.written.length).toBe(0);
    expect(document.tickId).toBe("handoff-9249-tick-7");
    expect(document.sources["capacity"]!.status).toBe("unavailable");
  });

  it("writes nothing when a supplied document is not its producer's", () => {
    const run = capture({ files: { ...FILES, "capacity.json": JSON.stringify({ hold: "yes" }) } });
    const code = runSupervisorTickDraft({
      deps: run.deps,
      rest: [...REQUIRED, "--capacity", "capacity.json", "--out", "draft.json"],
    });

    expect(code).toBe(EXIT_ERROR);
    expect(run.written.length).toBe(0);
    expect(run.diagnostics[0]!).toContain("is not a `slopweaver machine capacity --json` document");
  });

  it("names every file it could not read, in one run", () => {
    const run = capture({ files: { "actions.json": ACTIONS } });
    const code = runSupervisorTickDraft({
      deps: run.deps,
      rest: [...REQUIRED, "--capacity", "capacity.json", "--out", "draft.json"],
    });

    expect(code).toBe(EXIT_ERROR);
    expect(run.diagnostics.length).toBe(2);
    expect(run.diagnostics[0]!).toContain("--capacity capacity.json");
    expect(run.diagnostics[1]!).toContain("--judgements judgements.json");
  });

  it("exits usage and prints the usage line on a bad tail", () => {
    const run = capture({ files: FILES });
    const code = runSupervisorTickDraft({ deps: run.deps, rest: ["--out", "draft.json"] });

    expect(code).toBe(EXIT_USAGE);
    expect(run.written.length).toBe(0);
    expect(run.diagnostics.at(-1)!).toContain("usage: slopweaver supervisor tick-draft");
  });
});

describe("draftFileText", () => {
  it("adds the trailing newline a file ends with", () => {
    expect(unwrap(draftFileText({ cap: 10, text: "{}" }))).toBe("{}\n");
  });

  it("refuses a draft whose trailing newline would put the file past what tick-record reads back", () => {
    const refusal = unwrapErr(draftFileText({ cap: 4, text: "{{{{" }));

    expect(refusal).toStrictEqual(SupervisorErrors.draftOverReadLimit({ cap: 4, length: 4 }));
    expect(refusal.message).toBe(
      "the draft serialises to 4 characters, and the file's trailing newline would put it over the 4-character " +
        "limit `supervisor tick-record` reads it back under — so it would be written and then refused. Record " +
        "fewer actions or judgements in one tick.",
    );
  });
});

describe("the draft a tick-draft writes is one tick-record takes", () => {
  it("records the row, its capacity facts and the owner's turn off the reconciliation", async () => {
    const draftRun = capture({ files: FILES });
    runSupervisorTickDraft({
      deps: draftRun.deps,
      rest: [...REQUIRED, "--capacity", "capacity.json", "--out", "draft.json"],
    });
    const appended: SupervisorTickRow[] = [];
    const files: Record<string, string> = {
      "draft.json": draftRun.written[0]!.text,
      "reconcile.json": RECONCILE,
    };
    const code = await runSupervisorTickRecord({
      evidence: NOT_READ,
      deps: {
        // The sweep gate is exercised in its own file; these cases are about the recorder, so the hatch is open.
        hatchOpen: () => true,
        loadHatchOpen: () => true,
        idleHatchOpen: () => true,
        recipeFailureHatchOpen: () => true,
        voiceHatchOpen: () => true,
        readVoiceUnread: () => ({ kind: "read", neverMarked: false, unparseable: [], words: [] }),
        approvedDraftHatchOpen: () => true,
        readApprovedDrafts: () => ({
          items: [],
          answers: new Map(),
          kind: "read",
          landings: { bound: [], unreadable: [] },
          skippedLines: 0,
          unreadApproved: [],
          unsureIds: [],
        }),
        steerHatchOpen: () => true,
        readUnpickedSteers: () => Promise.resolve({ kind: "read", steers: [], undecodedRelays: 0 }),
        append: ({ row }) => {
          appended.push(row);
          return ok("/tmp/ledger/supervisor-ticks.jsonl");
        },
        now: () => "2026-09-12T21:30:00.000Z",
        readFile: ({ path }) => files[path]!,
        readChairPlans: () => {
          throw new Error("a not-read tick must never read a boot credential");
        },
        readClaudeCode: () => {
          throw new Error("a not-read tick must never read Claude Code");
        },
        readChairCanon: () => {
          throw new Error("a not-read tick must never read the chair's boot or canon");
        },
        readChairAutoCompactions: () => {
          throw new Error("a not-read tick must never read the chair's auto-compactions");
        },
        readCodexChairCanon: () => {
          throw new Error("a not-read tick must never read a Codex chair's canon");
        },
        readPlanRegister: () => {
          throw new Error("a not-read tick must never read the plan register");
        },
        readClaudeSide: () => {
          throw new Error("a not-read tick must never read the Claude side");
        },
        readCodexSeat: () => {
          throw new Error("a not-read tick must never ask for a Codex seat");
        },
        defaultHome: () => "/tmp/home",
        readStdin: () => "",
        writeDiagnostic: () => undefined,
        writeOut: () => undefined,
      },
      rest: ["--draft", "draft.json", "--reconcile", "reconcile.json"],
    });

    expect(code).toBe(EXIT_OK);
    expect(appended.length).toBe(1);
    expect(appended[0]!.tickId).toBe("handoff-9249-tick-7");
    expect(appended[0]!.sources.capacity).toMatchObject({
      facts: {
        dispatchBackoffSeconds: 0,
        dispatchCovering: 0,
        dispatchOpen: 0,
        dispatchSubject: "",
        hold: true,
        holdSubjects: ["cpu"],
        load1: 30.93,
        segmentsPct: 15,
        swapfileCount: 5,
        topForeignGb: 5.2,
        topForeignLabel: "mds",
      },
      status: "read",
    });
    expect(appended[0]!.actions.length).toBe(1);
    expect(appended[0]!.ownerTurns.turns.length).toBe(1);
    expect(appended[0]!.ownerTurns.turns[0]!.pointer).toBe("transcript:a1#t1");
  });
});
