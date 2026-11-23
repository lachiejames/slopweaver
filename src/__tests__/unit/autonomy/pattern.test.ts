/*
 * One word on a PATTERN of acts settles every act in it: seven acme-admin security-bump rebases, each its own
 * check-in, would otherwise each wait on a separate word even under a standing instruction that should clear
 * them all. A pattern is one kind, on one subject or in one identical `said`; its newest act governs.
 */

import { describe, expect, it } from "vitest";

import type { ActionIdConflictError } from "../../../autonomy/errors.js";
import {
  autonomyPatternKeys,
  filterAutonomyActions,
  foldAutonomy,
  groupPatterns,
  settlingClass,
  settlingPattern,
  steerOf,
} from "../../../autonomy/query.js";
import type {
  AutonomyActionRow,
  AutonomyClassSteerRow,
  AutonomyRecord,
  AutonomySteerRow,
} from "../../../autonomy/types.js";
import { runAutonomyList } from "../../../cli/commands/autonomy/list.js";
import { unwrap } from "../../../lib/result.js";
import { memoryAutonomyLedgerPort, seedAutonomyRecords } from "../../autonomyLedgerFixture.js";

const SAID =
  "I rebased your security PR onto staging so the reviewer sees it green; the dependency change itself is unchanged";
const PULLS = ["17554", "17531", "17524", "17522", "17553", "17535", "17519"];

/** One act, varying only what a test cares about. */
function act({
  actionId,
  kind = "rebase",
  subject,
  doneIso,
  said,
  steer,
}: {
  actionId: string;
  kind?: string;
  subject: string;
  doneIso: string;
  said?: string;
  steer?: string;
}): AutonomyActionRow {
  const base: AutonomyActionRow = {
    actionId,
    bySession: "handover acme-admin-nine-security-bumps",
    doneIso,
    kind,
    subject,
    why: "the PR already had a review ask; a stale PR with an ask is rebased and re-greened unasked",
    witness: "slopweaver github push --force-with-lease",
  };
  const withSaid = said === undefined ? base : { ...base, said };
  return steer === undefined ? withSaid : { ...withSaid, steer };
}

/** One steer event. */
function steerRow({ actionId, steer }: { actionId: string; steer: string }): AutonomySteerRow {
  return { actionId, bySession: "supervisor-handoff-9293", steer, steeredIso: "2026-09-28T07:11:54.363Z" };
}

/** The seven rebases, oldest first as the ledger wrote them: 17519 is the newest. */
const REBASES: readonly AutonomyActionRow[] = PULLS.map((pull, index) =>
  act({
    actionId: `${pull}-rebase-2026-09-28`,
    doneIso: `2026-09-28T01:49:3${String(index)}.000Z`,
    said: SAID,
    subject: `https://github.com/acme/acme-admin/pull/${pull}`,
  }),
);

const HIS_WORD = "definitely the desired behavior";

describe("seven rebases written up in one sentence", () => {
  it("are all settled by the owner's word on the newest, naming the act it was given on", () => {
    const folded = unwrap(
      foldAutonomy({ records: [...REBASES, steerRow({ actionId: "17519-rebase-2026-09-28", steer: HIS_WORD })] }),
    );
    expect(folded.map((entry) => steerOf({ action: entry }))).toEqual(Array.from({ length: 7 }, () => HIS_WORD));
    expect(folded.map((entry) => settlingPattern({ action: entry })?.actionId)).toEqual([
      undefined,
      ...Array.from({ length: 6 }, () => "17519-rebase-2026-09-28"),
    ]);
    expect(filterAutonomyActions({ actions: folded, unsteered: true })).toEqual([]);
  });

  it("stay unsteered, every one, until the owner says something", () => {
    const folded = unwrap(foldAutonomy({ records: REBASES }));
    expect(filterAutonomyActions({ actions: folded, unsteered: true })).toHaveLength(7);
  });

  it("are not settled by a word only on an earlier one, given before the newest existed", () => {
    const folded = unwrap(
      foldAutonomy({ records: [...REBASES, steerRow({ actionId: "17554-rebase-2026-09-28", steer: HIS_WORD })] }),
    );
    expect(filterAutonomyActions({ actions: folded, unsteered: true }).map((entry) => entry.action.actionId)).toEqual([
      "17519-rebase-2026-09-28",
      "17535-rebase-2026-09-28",
      "17553-rebase-2026-09-28",
      "17522-rebase-2026-09-28",
      "17524-rebase-2026-09-28",
      "17531-rebase-2026-09-28",
    ]);
  });

  it("carries the word on every earlier act, never on the act it was given on", () => {
    const folded = unwrap(
      foldAutonomy({ records: [...REBASES, steerRow({ actionId: "17519-rebase-2026-09-28", steer: HIS_WORD })] }),
    );
    expect(folded[1]!.patternSteer).toEqual({ actionId: "17519-rebase-2026-09-28", steer: HIS_WORD });
    expect(folded[0]!.patternSteer).toBeUndefined();
  });
});

describe("what one pattern word does not reach", () => {
  const governor = act({
    actionId: "new",
    doneIso: "2026-09-28T02:00:00.000Z",
    said: SAID,
    steer: HIS_WORD,
    subject: "https://github.com/acme/acme-admin/pull/1",
  });

  it("an act written up in a different sentence", () => {
    const other = act({
      actionId: "other",
      doneIso: "2026-09-28T01:00:00.000Z",
      said: `${SAID}.`,
      subject: "https://github.com/acme/acme-admin/pull/2",
    });
    const folded = unwrap(foldAutonomy({ records: [other, governor] }));
    expect(filterAutonomyActions({ actions: folded, unsteered: true }).map((entry) => entry.action.actionId)).toEqual([
      "other",
    ]);
  });

  it("an act of another kind in the same sentence", () => {
    const other = act({
      actionId: "other",
      doneIso: "2026-09-28T01:00:00.000Z",
      kind: "fix-red-ci",
      said: SAID,
      subject: "https://github.com/acme/acme-admin/pull/2",
    });
    const folded = unwrap(foldAutonomy({ records: [other, governor] }));
    expect(filterAutonomyActions({ actions: folded, unsteered: true })).toHaveLength(1);
  });

  it("an act with no sentence on another subject", () => {
    const other = act({
      actionId: "other",
      doneIso: "2026-09-28T01:00:00.000Z",
      subject: "https://github.com/acme/acme-admin/pull/2",
    });
    const folded = unwrap(foldAutonomy({ records: [other, governor] }));
    expect(filterAutonomyActions({ actions: folded, unsteered: true })).toHaveLength(1);
  });

  it("but does reach an earlier act of the same kind on the same subject, whatever its sentence", () => {
    const other = act({
      actionId: "other",
      doneIso: "2026-09-28T01:00:00.000Z",
      said: "I requeued it after the queue dropped it",
      subject: "https://github.com/acme/acme-admin/pull/1",
    });
    const folded = unwrap(foldAutonomy({ records: [other, governor] }));
    expect(filterAutonomyActions({ actions: folded, unsteered: true })).toEqual([]);
  });
});

describe("precedence against the other words", () => {
  const standing: AutonomyClassSteerRow = {
    actionId: "class.clear-owner-open-prs",
    anchor: "transcript:c3fd48ad#6d5d4a39",
    bySession: "supervisor",
    kinds: "rebase",
    steer: "clear rebasing without asking",
    steeredIso: "2026-09-28T07:40:00.000Z",
  };

  it("a word on the act itself outranks the pattern's", () => {
    const records: readonly AutonomyRecord[] = [
      ...REBASES,
      steerRow({ actionId: "17519-rebase-2026-09-28", steer: HIS_WORD }),
      steerRow({ actionId: "17554-rebase-2026-09-28", steer: "that one was wrong" }),
    ];
    const entry = unwrap(foldAutonomy({ records })).find((one) => one.action.actionId === "17554-rebase-2026-09-28")!;
    expect([steerOf({ action: entry }), settlingPattern({ action: entry })]).toEqual(["that one was wrong", undefined]);
  });

  it("the pattern's outranks a class steer, and a class steer still settles a pattern with no word", () => {
    const worded = unwrap(
      foldAutonomy({
        records: [...REBASES, standing, steerRow({ actionId: "17519-rebase-2026-09-28", steer: HIS_WORD })],
      }),
    )[1]!;
    expect([steerOf({ action: worded }), settlingClass({ action: worded })]).toEqual([HIS_WORD, undefined]);
    const unworded = unwrap(foldAutonomy({ records: [...REBASES, standing] }))[1]!;
    expect([steerOf({ action: unworded }), settlingClass({ action: unworded })?.actionId]).toEqual([
      standing.steer,
      standing.actionId,
    ]);
  });
});

describe("the pattern keys and their grouping", () => {
  it("keys an act with a sentence twice and one without once", () => {
    expect(autonomyPatternKeys({ action: { kind: "rebase", said: "x", subject: "s" }, rule: undefined })).toEqual([
      '["subject","rebase","s"]',
      '["said","rebase",null,"x"]',
    ]);
    expect(autonomyPatternKeys({ action: { kind: "rebase", subject: "s" }, rule: undefined })).toEqual([
      '["subject","rebase","s"]',
    ]);
  });

  it("keys one sentence apart under two standing rules, so a pattern never spans them", () => {
    const action = { kind: "rebase", said: "x", subject: "s" };
    expect([undefined, "a", "b"].map((rule) => autonomyPatternKeys({ action, rule })[1])).toEqual([
      '["said","rebase",null,"x"]',
      '["said","rebase","a","x"]',
      '["said","rebase","b","x"]',
    ]);
  });

  it("leaves an act a scoped rule covers settled, apart from a newer act in its sentence the rule does not cover", () => {
    const scoped: AutonomyClassSteerRow = {
      actionId: "class-scoped.b-rebases",
      anchor: "transcript:c3fd48ad#6d5d4a39",
      bySession: "supervisor",
      kinds: "rebase",
      steer: "rebase b's pull requests unasked",
      steeredIso: "2026-09-28T07:40:00.000Z",
      subjectPrefix: "https://b.example/",
    };
    const folded = unwrap(
      foldAutonomy({
        records: [
          act({ actionId: "O", doneIso: "2026-09-28T01:00:00.000Z", said: SAID, subject: "https://b.example/1" }),
          act({ actionId: "N", doneIso: "2026-09-28T02:00:00.000Z", said: SAID, subject: "https://a.example/1" }),
          scoped,
        ],
      }),
    );
    expect(folded.map((entry) => [entry.action.actionId, settlingClass({ action: entry })?.actionId])).toEqual([
      ["N", undefined],
      ["O", "class-scoped.b-rebases"],
    ]);
    expect(filterAutonomyActions({ actions: folded, unsteered: true }).map((entry) => entry.action.actionId)).toEqual([
      "N",
    ]);
  });

  it("joins through a shared member, whichever order the members arrive in", () => {
    const keys: Readonly<Record<string, readonly string[]>> = { a: ["p"], b: ["p", "q"], c: ["q"], d: ["r"] };
    const forward = groupPatterns({ items: ["a", "c", "b", "d"], keysOf: (item) => keys[item]! });
    const backward = groupPatterns({ items: ["d", "b", "c", "a"], keysOf: (item) => keys[item]! });
    expect(forward).toEqual([["a", "c", "b"], ["d"]]);
    expect(backward).toEqual([["d"], ["b", "c", "a"]]);
  });

  it("refuses one id carrying two sentences in either order, rather than grouping by whichever came first", () => {
    const first = act({ actionId: "x", doneIso: "2026-09-28T01:00:00.000Z", said: SAID, subject: "pr/1" });
    const second = { ...first, said: `${SAID}.` };
    const other = act({ actionId: "y", doneIso: "2026-09-28T00:00:00.000Z", said: SAID, subject: "pr/2" });
    const codes = [
      [first, second, other],
      [second, first, other],
    ].map((records) => foldAutonomy({ records })._unsafeUnwrapErr() as ActionIdConflictError);
    expect(codes.map((error) => [error.code, error.actionId, error.field])).toEqual([
      ["ACTION_ID_CONFLICT", "x", "said"],
      ["ACTION_ID_CONFLICT", "x", "said"],
    ]);
  });

  it("groups nothing out of nothing", () => {
    expect(groupPatterns({ items: [], keysOf: () => [] })).toEqual([]);
  });
});

describe("autonomy list over a ledger holding the pattern", () => {
  const home = "/fixture-home";

  it("prints the pattern word on an earlier act, naming the act it was given on, and lists none unsteered", async () => {
    const ledger = memoryAutonomyLedgerPort();
    await seedAutonomyRecords({
      port: ledger,
      records: [...REBASES, steerRow({ actionId: "17519-rebase-2026-09-28", steer: HIS_WORD })],
    });
    const out: string[] = [];
    const code = await runAutonomyList({
      deps: { ledger, writeDiagnostic: () => undefined, writeOut: (line) => out.push(line) },
      rest: ["--kind", "rebase", "--home", home],
    });
    expect(code).toBe(0);
    expect([out[2], out[5]]).toEqual([
      `    their steer: ${HIS_WORD}`,
      `    their word on this pattern, given on 17519-rebase-2026-09-28: ${HIS_WORD}`,
    ]);
    const unsteered: string[] = [];
    await runAutonomyList({
      deps: { ledger, writeDiagnostic: () => undefined, writeOut: (line) => unsteered.push(line) },
      rest: ["--unsteered", "--json", "--home", home],
    });
    expect(unsteered).toEqual([]);
  });
});
