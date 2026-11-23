/*
 * A class steer SCOPED to one place — the owner's word lets the fleet post as them in their own bot DM, and the
 * same kind aimed at a channel is still theirs to judge. The wire shape, the fold's latest-admissible choice, the
 * forged-attachment re-check and the verb, end to end over an in-memory store.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { buildAutonomyClassSteer, classAdmits, classIdOf } from "../../../autonomy/classSteer.js";
import { parseAutonomyLine, validateAutonomyRecord } from "../../../autonomy/decode.js";
import type { AutonomyLedgerPort } from "../../../autonomy/port.js";
import { filterAutonomyActions, foldAutonomy, settlingClass, steerOf } from "../../../autonomy/query.js";
import {
  AUTONOMY_CLASS_ID_PREFIX,
  AUTONOMY_SLUG_PATTERN,
  type AutonomyActionRow,
  type AutonomyClassSteerRow,
} from "../../../autonomy/types.js";
import { runAutonomySteerClass } from "../../../cli/commands/autonomy/steerClass.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { heldAutonomyRecords, memoryAutonomyLedgerPort } from "../../autonomyLedgerFixture.js";

const ANCHOR = "supervisor-scratch/handoff-9240/owner-turn-240-6.txt";
const WORDS = "you can post as me in my own DM with the bot";
const DM = "https://acme.slack.com/archives/D0SYN000001/";
const CHANNEL = "https://acme.slack.com/archives/C0SYN000002/p1790000000000100";

/** One act of a kind, on a subject. */
function act({
  actionId,
  kind = "slack.post.as-me",
  subject = `${DM}p1790000000000100`,
  steer,
}: {
  actionId: string;
  kind?: string;
  subject?: string;
  steer?: string;
}): AutonomyActionRow {
  const base: AutonomyActionRow = {
    actionId,
    bySession: "workspace:1",
    doneIso: "2026-09-27T02:00:00Z",
    kind,
    subject,
    why: "dogfood",
    witness: "slopweaver slack send",
  };
  return steer === undefined ? base : { ...base, steer };
}

/** One class steer, built the way the verb builds it. */
function classRow({
  classId = "post-as-owner-in-bot-dm",
  kinds = "slack.post.as-me,slack.post.as-me.one-card",
  steer = WORDS,
  subjectPrefix = DM,
  unscoped = false,
}: {
  classId?: string;
  kinds?: string;
  steer?: string;
  subjectPrefix?: string;
  unscoped?: boolean;
} = {}): AutonomyClassSteerRow {
  return unwrap(
    buildAutonomyClassSteer({
      anchor: ANCHOR,
      bySession: "supervisor",
      classId,
      kinds,
      steer,
      steeredIso: "2026-09-28T08:00:00Z",
      subjectPrefix: unscoped ? undefined : subjectPrefix,
    }),
  );
}

describe("the scoped class steer row", () => {
  it("names its class under class-scoped. and round-trips its scope through a stored line", () => {
    const row = classRow();
    expect([row.actionId, row.subjectPrefix, classIdOf({ row })]).toEqual([
      "class-scoped.post-as-owner-in-bot-dm",
      DM,
      "post-as-owner-in-bot-dm",
    ]);
    expect(unwrap(parseAutonomyLine({ line: JSON.stringify(row), lineNumber: 1 }))).toEqual(row);
  });

  it("reads to a build that knows only class. as a plain steer on an act that does not exist, so it settles nothing there", () => {
    // That build routes class. to its class arm and every other steer through buildAutonomySteer, which takes
    // any slug id and ignores fields it has never heard of — and its fold drops a steer naming no act.
    const row = classRow();
    expect([row.actionId.startsWith(AUTONOMY_CLASS_ID_PREFIX), AUTONOMY_SLUG_PATTERN.test(row.actionId)]).toEqual([
      false,
      true,
    ]);
    expect(Object.keys(row).toSorted()).toEqual([
      "actionId",
      "anchor",
      "bySession",
      "kinds",
      "steer",
      "steeredIso",
      "subjectPrefix",
    ]);
  });

  it("keeps an unscoped class under class. with no scope key at all", () => {
    const row = classRow({ unscoped: true });
    expect([row.actionId, Object.hasOwn(row, "subjectPrefix")]).toEqual(["class.post-as-owner-in-bot-dm", false]);
  });

  it("refuses a scope that is not a literal https URL through its host's slash or a state: path", () => {
    const refused = ["", "https://", "https:", "http://acme.slack.com/", "https://host", "a b", "https://h/ x"];
    const messages = refused.map(
      (subjectPrefix) =>
        unwrapErr(
          buildAutonomyClassSteer({
            anchor: ANCHOR,
            bySession: "s",
            classId: "c-d",
            kinds: "a-b",
            steer: "yes",
            steeredIso: "2026-09-28T08:00:00Z",
            subjectPrefix,
          }),
        ).message,
    );
    expect(messages.filter((message) => message.includes("a scope is a literal"))).toHaveLength(refused.length);
    expect(classRow({ subjectPrefix: "state:runs/one" }).subjectPrefix).toBe("state:runs/one");
  });

  it("refuses a scoped id with no scope, an unscoped id carrying one, and a scope that is not a string", () => {
    const base = { anchor: ANCHOR, bySession: "s", kinds: "a-b", steer: "yes", steeredIso: "2026-09-28T08:00:00Z" };
    const messages = [
      { ...base, actionId: "class-scoped.c-d" },
      { ...base, actionId: "class.c-d", subjectPrefix: DM },
      { ...base, actionId: "class-scoped.c-d", subjectPrefix: 7 },
    ].map((value) => unwrapErr(validateAutonomyRecord({ value })).message);
    expect(messages.filter((message) => message.includes("must be a string on a class-scoped. row"))).toHaveLength(3);
  });

  it("refuses an act and a per-act steer whose id takes the scoped prefix", () => {
    const refusedAct = validateAutonomyRecord({ value: act({ actionId: "class-scoped.x-y" }) });
    expect(unwrapErr(refusedAct).message).toContain("the class-scoped. prefix names the owner's standing word");
  });
});

describe("folding a scoped class onto the register", () => {
  const inDm = act({ actionId: "a-dm" });
  const inChannel = act({ actionId: "a-channel", kind: "slack.post.as-me.one-card", subject: CHANNEL });

  it("settles the acts inside its scope and leaves the same kind elsewhere on the owner's list", () => {
    const folded = unwrap(foldAutonomy({ records: [inDm, inChannel, classRow()] }));
    const unsteered = filterAutonomyActions({ actions: folded, unsteered: true });
    expect(unsteered.map((entry) => entry.action.actionId)).toEqual(["a-channel"]);
  });

  it("matches its scope literally and case-sensitively, one character short of it settling nothing", () => {
    const row = classRow();
    const cases = [`${DM}p1`, DM.toLowerCase(), DM.slice(0, -1), "https://acme.slack.com/archives/D0SYN00011/"];
    expect(cases.map((subject) => classAdmits({ kind: "slack.post.as-me", row, subject }))).toEqual([
      true,
      false,
      false,
      false,
    ]);
  });

  it("lets a later scoped class fall through to an earlier unscoped one outside its scope", () => {
    const everywhere = classRow({ classId: "everywhere", steer: "everywhere", unscoped: true });
    const folded = unwrap(foldAutonomy({ records: [inDm, inChannel, everywhere, classRow()] }));
    const byId = new Map(folded.map((entry) => [entry.action.actionId, entry]));
    expect([steerOf({ action: byId.get("a-dm")! }), steerOf({ action: byId.get("a-channel")! })]).toEqual([
      WORDS,
      "everywhere",
    ]);
  });

  it("replaces a class re-recorded with a scope, rather than leaving its unscoped spelling in force", () => {
    const unscoped = classRow({ steer: "unscoped", unscoped: true });
    const folded = unwrap(foldAutonomy({ records: [inDm, inChannel, unscoped, classRow()] }));
    const unsteered = filterAutonomyActions({ actions: folded, unsteered: true });
    expect(unsteered.map((entry) => entry.action.actionId)).toEqual(["a-channel"]);
  });

  it("lets a word on the act itself outrank a scoped class that admits it", () => {
    const worded = act({ actionId: "a-worded", steer: "that one read badly" });
    const folded = unwrap(foldAutonomy({ records: [worded, classRow()] }));
    expect([steerOf({ action: folded[0]! }), settlingClass({ action: folded[0]! })]).toEqual([
      "that one read badly",
      undefined,
    ]);
  });

  it("settles nothing when a scoped class is attached by hand to an act outside its scope", () => {
    const entry = { action: inChannel, classSteer: classRow(), latestSteer: undefined, patternSteer: undefined };
    expect([steerOf({ action: entry }), settlingClass({ action: entry })]).toEqual([undefined, undefined]);
  });
});

describe("recording a scoped class through the verb", () => {
  const home = "/fixture-home";
  let ledger: AutonomyLedgerPort;
  beforeEach(() => {
    ledger = memoryAutonomyLedgerPort();
  });

  it("writes the scope and prints it, so the recording never reads broader than it is", async () => {
    const out: string[] = [];
    const diagnostics: string[] = [];
    const code = await runAutonomySteerClass({
      deps: {
        ledger,
        now: () => "2026-09-28T08:00:00.000Z",
        writeDiagnostic: (line) => diagnostics.push(line),
        writeOut: (line) => out.push(line),
      },
      rest: [
        "post-as-owner-in-bot-dm",
        "--kinds",
        "slack.post.as-me",
        "--steer",
        WORDS,
        "--anchor",
        ANCHOR,
        "--subject-prefix",
        DM,
        "--by-session",
        "supervisor",
        "--home",
        home,
      ],
    });
    expect([code, diagnostics]).toEqual([0, []]);
    expect(out[0]).toBe(
      `autonomy steer-class: recorded their standing word on post-as-owner-in-bot-dm, settling 1 kind(s) wherever the subject starts ${DM}`,
    );
    const stored = await heldAutonomyRecords({ port: ledger });
    expect(stored.map((row) => row.actionId)).toEqual(["class-scoped.post-as-owner-in-bot-dm"]);
  });

  it("refuses a scope that is not a literal URL prefix and writes nothing", async () => {
    const diagnostics: string[] = [];
    const code = await runAutonomySteerClass({
      deps: {
        ledger,
        now: () => "2026-09-28T08:00:00.000Z",
        writeDiagnostic: (line) => diagnostics.push(line),
        writeOut: () => undefined,
      },
      rest: [
        "post-as-owner-in-bot-dm",
        "--kinds",
        "slack.post.as-me",
        "--steer",
        WORDS,
        "--anchor",
        ANCHOR,
        "--subject-prefix",
        "https:",
        "--by-session",
        "supervisor",
        "--home",
        home,
      ],
    });
    expect(code).toBe(1);
    expect(diagnostics[0]).toContain("a scope is a literal");
    expect(await heldAutonomyRecords({ port: ledger })).toEqual([]);
  });
});
