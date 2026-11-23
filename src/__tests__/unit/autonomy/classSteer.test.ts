/*
 * The owner's standing word on a whole CLASS of act — the row, the fold that applies it to every act of its kinds,
 * the append that accepts it with no act behind it, and the verb that records it, end to end over an
 * in-memory store.
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
  buildAutonomyClassSteer,
  canonicalClassKinds,
  classIdOf,
  isClassSteerRecord,
} from "../../../autonomy/classSteer.js";
import { parseAutonomyLine, validateAutonomyRecord } from "../../../autonomy/decode.js";
import type { AutonomyLedgerPort } from "../../../autonomy/port.js";
import { classCoverage, filterAutonomyActions, foldAutonomy, settlingClass, steerOf } from "../../../autonomy/query.js";
import { isSteerRecord } from "../../../autonomy/row.js";
import type { AutonomyActionRow, AutonomyClassSteerRow, AutonomyRecord } from "../../../autonomy/types.js";
import { runAutonomyList } from "../../../cli/commands/autonomy/list.js";
import { type AutonomySteerClassDeps, runAutonomySteerClass } from "../../../cli/commands/autonomy/steerClass.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { heldAutonomyRecords, memoryAutonomyLedgerPort, seedAutonomyRecords } from "../../autonomyLedgerFixture.js";

const ANCHOR = "transcript:a0000032-0000-4000-8000-000000000035#70ca5dd7-53e3-4685-b245-32a1a9b10fc1";
const WORDS = "pressing merge when ready or just self-merging Slopweaver PRs has been like the standing rule for ages";

/** One act, varying only what a test cares about. */
function act({
  actionId,
  kind,
  doneIso = "2026-09-20T02:00:00Z",
  steer,
}: {
  actionId: string;
  kind: string;
  doneIso?: string;
  steer?: string;
}): AutonomyActionRow {
  const base: AutonomyActionRow = {
    actionId,
    bySession: "workspace:1",
    doneIso,
    kind,
    subject: "https://github.com/lachiejames/slopweaver/pull/1336",
    why: "green",
    witness: "slopweaver github enqueue --pr 1336",
  };
  return steer === undefined ? base : { ...base, steer };
}

/** One class steer, built the way the verb builds it. */
function classRow({
  classId = "self-merge-owner-prs",
  kinds = "press-merge-when-ready,land-own-pull-request",
  steer = WORDS,
  steeredIso = "2026-09-26T06:30:00Z",
}: {
  classId?: string;
  kinds?: string;
  steer?: string;
  steeredIso?: string;
} = {}): AutonomyClassSteerRow {
  return unwrap(
    buildAutonomyClassSteer({ anchor: ANCHOR, bySession: "supervisor", classId, kinds, steer, steeredIso }),
  );
}

describe("the class steer row", () => {
  it("names its class under the class. prefix and writes its kinds in canonical form", () => {
    const row = classRow({ kinds: " press-merge-when-ready , land-own-pull-request" });
    expect([row.actionId, row.kinds, classIdOf({ row })]).toEqual([
      "class.self-merge-owner-prs",
      "press-merge-when-ready,land-own-pull-request",
      "self-merge-owner-prs",
    ]);
  });

  it("refuses a kind named twice, an empty member and a pattern", () => {
    const messages = ["a-b,a-b", "a-b,,c-d", "press-*"].map(
      (kinds) => unwrapErr(canonicalClassKinds({ kinds })).message,
    );
    expect(messages[0]).toContain('names "a-b" twice');
    expect(messages[1]).toContain('carries ""');
    expect(messages[2]).toContain('carries "press-*"');
  });

  it("round-trips through a stored line as a class steer, which is also a steer", () => {
    const line = JSON.stringify(classRow());
    const parsed = unwrap(parseAutonomyLine({ line, lineNumber: 1 }));
    expect([isClassSteerRecord(parsed), isSteerRecord(parsed)]).toEqual([true, true]);
    expect(parsed).toEqual(classRow());
  });

  it("stores only the fields an older build reads as a steer on an unknown act, plus kinds and anchor", () => {
    // An older build's steer arm refuses any act-only field beside steeredIso and ignores every other one, so
    // this exact key set is what keeps a class steer from taking the register off a stale checkout.
    expect(Object.keys(classRow()).toSorted()).toEqual([
      "actionId",
      "anchor",
      "bySession",
      "kinds",
      "steer",
      "steeredIso",
    ]);
  });

  it("reads a per-act steer with a stray kinds field as the steer it always was, and refuses a class id with no kinds", () => {
    const legacy = unwrap(
      validateAutonomyRecord({
        value: { actionId: "a-one", bySession: "s", kinds: "a-b", steer: "yes", steeredIso: "2026-09-26T06:30:00Z" },
      }),
    );
    expect([legacy, isClassSteerRecord(legacy)]).toEqual([
      { actionId: "a-one", bySession: "s", steer: "yes", steeredIso: "2026-09-26T06:30:00Z" },
      false,
    ]);
    const bare = validateAutonomyRecord({
      value: { actionId: "class.x-y", bySession: "s", steer: "yes", steeredIso: "2026-09-26T06:30:00Z" },
    });
    expect(unwrapErr(bare).message).toContain("a class steer must carry an actionId starting class.");
  });

  it("refuses an act whose id takes the class prefix", () => {
    const refused = validateAutonomyRecord({ value: act({ actionId: "class.x-y", kind: "enqueue" }) });
    expect(unwrapErr(refused).message).toContain("names the owner's standing word on a class of act, never an act");
  });
});

describe("folding a class steer onto the register", () => {
  const before = act({ actionId: "a-before", doneIso: "2026-09-20T02:00:00Z", kind: "press-merge-when-ready" });
  const after = act({ actionId: "a-after", doneIso: "2026-09-27T02:00:00Z", kind: "land-own-pull-request" });
  const finding = act({ actionId: "a-finding", kind: "open-internal-finding-pull-request" });

  it("settles every act of a listed kind, before and after the note, and no other kind", () => {
    const records: readonly AutonomyRecord[] = [before, classRow(), after, finding];
    const folded = unwrap(foldAutonomy({ records }));
    const unsteered = filterAutonomyActions({ actions: folded, unsteered: true });
    expect(unsteered.map((entry) => entry.action.actionId)).toEqual(["a-finding"]);
    expect(folded.map((entry) => steerOf({ action: entry }))).toEqual([WORDS, WORDS, undefined]);
  });

  it("lets a word on the act itself outrank the class, whether a later steer or an inline one", () => {
    const inline = act({ actionId: "a-inline", kind: "press-merge-when-ready", steer: "that one was wrong" });
    const records: readonly AutonomyRecord[] = [
      before,
      inline,
      classRow(),
      { actionId: "a-before", bySession: "supervisor", steer: "broken links", steeredIso: "2026-09-26T07:00:00Z" },
    ];
    const folded = unwrap(foldAutonomy({ records }));
    const byId = new Map(folded.map((entry) => [entry.action.actionId, entry]));
    expect(steerOf({ action: byId.get("a-before")! })).toBe("broken links");
    expect(steerOf({ action: byId.get("a-inline")! })).toBe("that one was wrong");
    expect(settlingClass({ action: byId.get("a-before")! })).toBe(undefined);
  });

  it("reads a re-recorded class as its whole current list, so a dropped kind comes back to the owner", () => {
    const narrowed = classRow({ kinds: "press-merge-when-ready", steer: "only presses" });
    const folded = unwrap(foldAutonomy({ records: [before, after, classRow(), narrowed] }));
    const unsteered = filterAutonomyActions({ actions: folded, unsteered: true });
    expect(unsteered.map((entry) => entry.action.actionId)).toEqual(["a-after"]);
  });

  it("lists an overlapping kind's classes in append order, so the class appended later governs it", () => {
    const first = classRow({ classId: "first-class", kinds: "enqueue,merge-own-pr", steer: "first" });
    const second = classRow({ classId: "second-class", kinds: "merge-own-pr", steer: "second" });
    const coverage = classCoverage({ classes: [first, second] });
    expect([
      coverage.get("enqueue")!.map((row) => row.steer),
      coverage.get("merge-own-pr")!.map((row) => row.steer),
    ]).toEqual([["first"], ["first", "second"]]);
  });

  it("moves a re-recorded class to the end of the order, so it wins an overlap it lost before", () => {
    const first = classRow({ classId: "first-class", kinds: "merge-own-pr", steer: "first" });
    const second = classRow({ classId: "second-class", kinds: "merge-own-pr", steer: "second" });
    const again = classRow({ classId: "first-class", kinds: "merge-own-pr", steer: "first again" });
    const naming = classCoverage({ classes: [first, second, again] }).get("merge-own-pr")!;
    expect(naming.map((row) => row.steer)).toEqual(["second", "first again"]);
  });
});

describe("appending and recording a class steer", () => {
  const home = "/fixture-home";
  let ledger: AutonomyLedgerPort;
  beforeEach(() => {
    ledger = memoryAutonomyLedgerPort();
  });

  it("appends with no act of its kinds in the ledger yet", async () => {
    const written = unwrap(await ledger.appendRecord({ home, record: classRow() }));
    expect([written.actionId, written.appended]).toEqual(["class.self-merge-owner-prs", true]);
    expect(await heldAutonomyRecords({ port: ledger })).toEqual([classRow()]);
  });

  it("records through the verb, and list --unsteered then shows only the kinds it does not name", async () => {
    await seedAutonomyRecords({
      port: ledger,
      records: [
        act({ actionId: "a-press", kind: "press-merge-when-ready" }),
        act({ actionId: "a-finding", kind: "open-internal-finding-pull-request" }),
      ],
    });
    const out: string[] = [];
    const diagnostics: string[] = [];
    const deps: AutonomySteerClassDeps = {
      ledger,
      now: () => "2026-09-26T06:30:00.000Z",
      writeDiagnostic: (line) => {
        diagnostics.push(line);
      },
      writeOut: (line) => {
        out.push(line);
      },
    };
    const code = await runAutonomySteerClass({
      deps,
      rest: [
        "self-merge-owner-prs",
        "--kinds",
        "press-merge-when-ready,land-own-pull-request",
        "--steer",
        WORDS,
        "--anchor",
        ANCHOR,
        "--by-session",
        "supervisor",
        "--home",
        home,
      ],
    });
    expect([code, diagnostics]).toEqual([0, []]);
    expect(out[0]).toBe(
      "autonomy steer-class: recorded their standing word on self-merge-owner-prs, settling 2 kind(s)",
    );
    const listed: string[] = [];
    await runAutonomyList({
      deps: { ledger, writeDiagnostic: () => undefined, writeOut: (line) => listed.push(line) },
      rest: ["--unsteered", "--json", "--home", home],
    });
    expect(listed.map((line) => (JSON.parse(line) as { action: { actionId: string } }).action.actionId)).toEqual([
      "a-finding",
    ]);
    const human: string[] = [];
    await runAutonomyList({
      deps: { ledger, writeDiagnostic: () => undefined, writeOut: (line) => human.push(line) },
      rest: ["--kind", "press-merge-when-ready", "--home", home],
    });
    expect(human[2]).toBe(`    their standing word on self-merge-owner-prs (${ANCHOR}): ${WORDS}`);
    expect(await heldAutonomyRecords({ port: ledger })).toHaveLength(3);
  });

  it("refuses a missing anchor as a usage error and writes nothing", async () => {
    const diagnostics: string[] = [];
    const code = await runAutonomySteerClass({
      deps: {
        ledger,
        now: () => "2026-09-26T06:30:00.000Z",
        writeDiagnostic: (line) => diagnostics.push(line),
        writeOut: () => undefined,
      },
      rest: [
        "self-merge-owner-prs",
        "--kinds",
        "enqueue",
        "--steer",
        WORDS,
        "--by-session",
        "supervisor",
        "--home",
        home,
      ],
    });
    expect(code).toBe(2);
    expect(diagnostics[0]).toContain("--anchor");
    expect(await heldAutonomyRecords({ port: ledger })).toEqual([]);
  });

  it("refuses a word carrying a bare reference, which every act of its kinds would show as text", async () => {
    const diagnostics: string[] = [];
    const code = await runAutonomySteerClass({
      deps: {
        ledger,
        now: () => "2026-09-26T06:30:00.000Z",
        writeDiagnostic: (line) => diagnostics.push(line),
        writeOut: () => undefined,
      },
      rest: [
        "self-merge-owner-prs",
        "--kinds",
        "enqueue",
        "--steer",
        "fine, as on #1711",
        "--anchor",
        ANCHOR,
        "--by-session",
        "supervisor",
        "--home",
        home,
      ],
    });
    expect(code).toBe(1);
    expect(diagnostics[0]).toContain("autonomy steer-class: the act would carry a reference onto the briefing");
    expect(diagnostics[0]).toContain('"#1711"');
    expect(await heldAutonomyRecords({ port: ledger })).toEqual([]);
  });
});

describe("a class steer attached to an act whose kind it does not name", () => {
  it("settles nothing, whoever built the entry", () => {
    const entry = {
      action: act({ actionId: "a-finding", kind: "open-internal-finding-pull-request" }),
      classSteer: classRow({ kinds: "press-merge-when-ready" }),
      latestSteer: undefined,
      patternSteer: undefined,
    };
    expect([steerOf({ action: entry }), settlingClass({ action: entry })]).toEqual([undefined, undefined]);
    expect(filterAutonomyActions({ actions: [entry], unsteered: true })).toHaveLength(1);
  });
});
