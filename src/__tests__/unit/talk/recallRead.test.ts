/*
 * The disk half of `talk recall`, over a real home in a temp directory: a synthetic Acme steer (the words of
 * a call turn pointer, cut short) is found in a call transcript, a relayed steer, a
 * journalled ruling and an archived ruling row, and each hit's pointer opens the record it names.
 *
 * Per `testing.md`, every write goes to the `home` this file mints — never the ambient one.
 */
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { rulingArchiveDir } from "../../../handover/archivedRulings.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";
import type { CallEntry } from "../../../talk/callRecord.js";
import { appendCallEntries, callsDir } from "../../../talk/callStore.js";
import { type RecallSourceRead } from "../../../talk/recall.js";
import { openDiskRecall } from "../../../talk/recallOpenRead.js";
import { parseRecallPointer, type RecallPointer } from "../../../talk/recallPointer.js";
import { searchCalls, searchSteers } from "../../../talk/recallRead.js";
import { searchRulings } from "../../../talk/recallRulings.js";
import { formRelayDraft } from "../../../talk/relayDraft.js";
import { claimTurn, markRegistered } from "../../../talk/relayStore.js";

const CALL = "7e0b1556-4864-42a6-bd10-675d331b2942";
const TURN = "951b9e45-6fc9-45fd-8e25-d04ded7164c9";
const STEER_WORDS = "I know we said maybe the Acme ledger should not even sync on its own";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "talk-recall-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** One spoken segment, overridable. */
const segment = (over: Partial<Extract<CallEntry, { kind: "segment" }>>): CallEntry => ({
  atIso: "2026-10-08T00:08:05.463Z",
  final: true,
  id: "turn_000000000000000000014",
  kind: "segment",
  text: STEER_WORDS,
  who: "owner",
  ...over,
});

/** Write the call: the voice's question, the owner's steer, the voice's answer, then a partial snapshot superseded by a final. */
const writeCall = (): void => {
  const entries: CallEntry[] = [
    segment({
      atIso: "2026-10-08T00:06:59.863Z",
      id: "turn_before",
      text: "Did you mean this Acme request?",
      who: "voice",
    }),
    segment({ final: false, text: "I know we said" }),
    segment({ open: "hand:mon-signin-go-acme-com.5" }),
    segment({
      atIso: "2026-10-08T00:08:20.435Z",
      id: "turn_after",
      text: "The sidebar still quotes it.",
      who: "voice",
    }),
  ];
  unwrap(
    appendCallEntries({
      callId: CALL,
      entries,
      home,
      pid: 101,
      startOf: () => ({ running: true, start: "t101" }),
    }),
  );
};

/** Relay the owner's steer and register it, so it has a receipt. */
const writeSteer = (): void => {
  const draft = unwrap(
    formRelayDraft({
      about: "",
      heard: STEER_WORDS,
      picture: { kind: "none", reason: "screen-not-shared" },
      readsAfter: [],
      say: "Stop the scheduled Acme sync",
      turnId: TURN,
      typed: false,
      wordsAlone: false,
    }),
  );
  const claimed = unwrap(claimTurn({ draft, home, nowIso: "2026-10-08T00:08:00.000Z" }));
  unwrap(markRegistered({ home, nowIso: "2026-10-08T00:08:00.604Z", record: claimed.record }));
};

/** A run journal with one unrelated event and one ruling, on line 2. */
const writeRuling = (): void => {
  const runs = stateHomePaths({ home }).runs;
  mkdirSync(runs, { recursive: true });
  const path = join(runs, "acme-resync-on-demand.jsonl");
  appendFileSync(path, `${JSON.stringify({ atIso: "2026-10-08T07:30:00.000Z", kind: "abandoned", why: "acme" })}\n`);
  appendFileSync(
    path,
    `${JSON.stringify({
      anchor: `talk-call:${CALL}#turn_000000000000000000014`,
      atIso: "2026-10-08T07:37:55.355Z",
      kind: "ruling",
      ruling: "Retired: Acme does not run a scheduled sync.",
    })}\n`,
  );
};

/** An archived state doc with one anchored row under RULINGS, on line 3. */
const writeArchive = (): void => {
  const dir = rulingArchiveDir({ home });
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "2026-10-08-board.md"),
    "# Board\n### RULINGS\n- Acme sync is on demand only (https://example.invalid/anchor)\n### NEXT\n- acme later\n",
  );
};

const ALL_TIME = { home: "", sinceMs: undefined, words: ["acme", "sync"] } as const;

/** The matches of a searched read; a test of an unsearched one asserts that directly. */
const matchesOf = (read: RecallSourceRead) => {
  expect(read.searched).toBe(true);
  return (read as Extract<RecallSourceRead, { searched: true }>).matches;
};

describe("searchCalls", () => {
  it("finds the owner's steer in the FOLDED call, once, at its final snapshot, with the card it was said over", () => {
    writeCall();
    const matches = matchesOf(searchCalls({ ...ALL_TIME, home }));
    expect(matches.map((match) => match.text)).toEqual([STEER_WORDS]);
    expect(matches[0]!.about).toBe("hand:mon-signin-go-acme-com.5");
    expect(matches[0]!.pointer).toBe(`talk-call:${CALL}#turn_000000000000000000014`);
  });

  it("skips a call older than the window, and an install with no calls is a searched zero", () => {
    writeCall();
    const later = Date.parse("2026-10-09T00:00:00.000Z");
    expect(matchesOf(searchCalls({ ...ALL_TIME, home, sinceMs: later }))).toEqual([]);
    const empty = mkdtempSync(join(tmpdir(), "talk-recall-empty-"));
    expect(searchCalls({ ...ALL_TIME, home: empty })).toEqual({
      count: 0,
      incomplete: undefined,
      matches: [],
      searched: true,
    });
    rmSync(empty, { force: true, recursive: true });
  });

  it("says a calls directory linked to nothing could not be read, rather than counting it an exact zero", () => {
    const dir = callsDir({ home });
    mkdirSync(dirname(dir), { recursive: true });
    symlinkSync(join(home, "nowhere"), dir);
    const read = searchCalls({ ...ALL_TIME, home });
    expect(read.searched).toBe(false);
    const { why } = read as Extract<RecallSourceRead, { searched: false }>;
    expect(why).toContain(`talk recall: could not read ${dir}`);
    expect(why).toContain("ENOENT");
  });

  it("windows by each record's own instant, so a file whose mtime predates the window still answers", () => {
    writeCall();
    writeRuling();
    const before = Date.parse("2026-10-01T00:00:00.000Z") / 1000;
    const callFile = join(callsDir({ home }), `${CALL}.jsonl`);
    const journal = join(stateHomePaths({ home }).runs, "acme-resync-on-demand.jsonl");
    utimesSync(callFile, before, before);
    utimesSync(journal, before, before);
    const window = { ...ALL_TIME, home, sinceMs: Date.parse("2026-10-08T00:00:00.000Z") };
    expect(matchesOf(searchCalls(window)).map((match) => match.text)).toEqual([STEER_WORDS]);
    expect(matchesOf(searchRulings(window)).map((match) => match.about)).toEqual(["acme-resync-on-demand"]);
  });
});

describe("searchCalls over a JSON-escaped letter", () => {
  it("finds a turn whose raw line spells acme as \\u0061cme, which the decoded text still matches", () => {
    writeCall();
    const path = join(callsDir({ home }), `${CALL}.jsonl`);
    const raw = readFileSync(path, "utf8");
    const escaped = raw.replaceAll("Acme", "\\u0041cme").replaceAll("acme", "\\u0061cme");
    expect(raw.toLowerCase()).toContain("acme");
    expect(escaped.toLowerCase()).not.toContain("acme");
    writeFileSync(path, escaped);
    const matches = matchesOf(searchCalls({ ...ALL_TIME, home }));
    expect(matches.map((match) => match.text)).toEqual([STEER_WORDS]);
  });
});

describe("searchSteers", () => {
  it("finds the relayed steer by the words the owner said, pointing at its turn", () => {
    writeSteer();
    const matches = matchesOf(searchSteers({ ...ALL_TIME, home }));
    expect(matches.map((match) => match.pointer)).toEqual([`talk:${TURN}`]);
    expect(matches[0]!.atIso).toBe("2026-10-08T00:08:00.604Z");
  });

  it("says a relay ledger linked to nothing could not be read, while an install with none is a searched zero", () => {
    expect(matchesOf(searchSteers({ ...ALL_TIME, home }))).toEqual([]);
    const ledger = stateHomePaths({ home }).talkRelaysJsonl;
    mkdirSync(dirname(ledger), { recursive: true });
    symlinkSync(join(home, "nowhere.jsonl"), ledger);
    const read = searchSteers({ ...ALL_TIME, home });
    expect(read.searched).toBe(false);
    expect((read as Extract<RecallSourceRead, { searched: false }>).why).toContain("ENOENT");
  });
});

describe("searchRulings", () => {
  it("finds a journalled ruling by its line and an archived row by its file, and nothing outside RULINGS", () => {
    writeRuling();
    writeArchive();
    const matches = matchesOf(searchRulings({ ...ALL_TIME, home }));
    expect(matches.map((match) => match.pointer).toSorted()).toEqual([
      "ruling-archive:2026-10-08-board.md#L3",
      "ruling-run:acme-resync-on-demand#L2",
    ]);
  });

  it("finds a journalled ruling whose kind and words are JSON-escaped", () => {
    const runs = stateHomePaths({ home }).runs;
    mkdirSync(runs, { recursive: true });
    const line = JSON.stringify({
      anchor: `talk-call:${CALL}#turn_000000000000000000014`,
      atIso: "2026-10-08T07:37:55.355Z",
      kind: "ruling",
      ruling: "Acme does not run a scheduled sync.",
    })
      .replace('"ruling":', '"\\u0072uling":')
      .replace('"kind":"ruling"', '"kind": "\\u0072uling"')
      .replace("Acme does", "\\u0041cme does");
    writeFileSync(join(runs, "escaped.jsonl"), `${line}\n`);
    expect(matchesOf(searchRulings({ ...ALL_TIME, home })).map((match) => match.text)).toEqual([
      "Acme does not run a scheduled sync.",
    ]);
  });

  it("counts a torn journal line carrying the words against the source rather than dropping it", () => {
    writeRuling();
    appendFileSync(
      join(stateHomePaths({ home }).runs, "torn.jsonl"),
      '{"kind":"ruling","atIso":"2026-10-10T00:00:00.000Z","ruling":"acme sync"\n',
    );
    const read = searchRulings({ ...ALL_TIME, home });
    expect(matchesOf(read).map((match) => match.pointer)).toEqual(["ruling-run:acme-resync-on-demand#L2"]);
    expect((read as Extract<RecallSourceRead, { searched: true }>).incomplete).toBe(
      "1 journal line(s) carrying the words did not decode",
    );
  });

  it("names an archive it could not list rather than counting it an exact zero", () => {
    writeRuling();
    mkdirSync(stateHomePaths({ home }).handovers, { recursive: true });
    writeFileSync(rulingArchiveDir({ home }), "not a directory");
    const read = searchRulings({ ...ALL_TIME, home });
    expect(matchesOf(read).map((match) => match.pointer)).toEqual(["ruling-run:acme-resync-on-demand#L2"]);
    expect((read as Extract<RecallSourceRead, { searched: true }>).incomplete).toContain("ENOTDIR");
  });

  it("names an archive linked to nothing rather than reading it as no archive", () => {
    writeRuling();
    const archive = rulingArchiveDir({ home });
    mkdirSync(dirname(archive), { recursive: true });
    symlinkSync(join(home, "nowhere"), archive);
    const read = searchRulings({ ...ALL_TIME, home });
    expect(matchesOf(read).map((match) => match.pointer)).toEqual(["ruling-run:acme-resync-on-demand#L2"]);
    expect((read as Extract<RecallSourceRead, { searched: true }>).incomplete).toContain(`${archive}: Error: ENOENT`);
  });

  it("names an archived file it would not open rather than skipping it silently", () => {
    writeArchive();
    const outside = mkdtempSync(join(tmpdir(), "talk-recall-outside-"));
    writeFileSync(join(outside, "elsewhere.md"), "### RULINGS\n- Acme sync elsewhere (https://example.invalid/b)\n");
    symlinkSync(join(outside, "elsewhere.md"), join(rulingArchiveDir({ home }), "linked.md"));
    const read = searchRulings({ ...ALL_TIME, home });
    expect(matchesOf(read).map((match) => match.pointer)).toEqual(["ruling-archive:2026-10-08-board.md#L3"]);
    expect((read as Extract<RecallSourceRead, { searched: true }>).incomplete).toBe("linked.md is not a regular file");
    rmSync(outside, { force: true, recursive: true });
  });
});

describe("openDiskRecall", () => {
  /** Open a pointer text against the home. */
  const open = ({ text }: { text: string }) => {
    const pointer = unwrap(parseRecallPointer({ text }));
    expect(pointer.kind === "knowledge").toBe(false);
    return openDiskRecall({ home, pointer: pointer as Exclude<typeof pointer, { kind: "knowledge" }>, text });
  };

  it("opens a call turn with the turns either side", () => {
    writeCall();
    const record = unwrap(open({ text: `talk-call:${CALL}#turn_000000000000000000014` }));
    expect(record.text).toBe(STEER_WORDS);
    expect(record.before.map((turn) => turn.text)).toEqual(["Did you mean this Acme request?"]);
    expect(record.after.map((turn) => turn.text)).toEqual(["The sidebar still quotes it."]);
    expect(record.detail["card"]).toBe("hand:mon-signin-go-acme-com.5");
  });

  it("opens a steer, a journalled ruling and an archived row", () => {
    writeSteer();
    writeRuling();
    writeArchive();
    expect(unwrap(open({ text: `talk:${TURN}` })).text).toBe(STEER_WORDS);
    expect(unwrap(open({ text: "ruling-run:acme-resync-on-demand#L2" })).text).toBe(
      "Retired: Acme does not run a scheduled sync.",
    );
    expect(unwrap(open({ text: "ruling-archive:2026-10-08-board.md#L3" })).text).toBe(
      "- Acme sync is on demand only (https://example.invalid/anchor)",
    );
  });

  it("says a pointer names nothing, rather than answering empty", () => {
    writeRuling();
    expect(unwrapErr(open({ text: "ruling-run:acme-resync-on-demand#L1" })).code).toBe("RECALL_NOT_FOUND");
    expect(unwrapErr(open({ text: "ruling-run:no-such-run#L1" })).code).toBe("RECALL_NOT_FOUND");
    expect(unwrapErr(open({ text: `talk-call:${CALL}#turn_missing` })).code).toBe("RECALL_NOT_FOUND");
  });

  it("refuses a call file that is a symlink, rather than following it out of the home", () => {
    const outside = mkdtempSync(join(tmpdir(), "talk-recall-outside-"));
    const target = join(outside, "outside.jsonl");
    appendFileSync(target, `${JSON.stringify(segment({ id: "secret", text: "outside secret" }))}\n`);
    mkdirSync(callsDir({ home }), { recursive: true });
    symlinkSync(target, join(callsDir({ home }), `${CALL}.jsonl`));
    const failure = unwrapErr(open({ text: `talk-call:${CALL}#secret` }));
    expect(failure.code).toBe("RECALL_NOT_FOUND");
    expect(failure.message).not.toContain("outside secret");
    rmSync(outside, { force: true, recursive: true });
  });

  it("refuses a call read through a calls directory linked out of the home, which opens fine in its own home", () => {
    const outside = mkdtempSync(join(tmpdir(), "talk-recall-outside-"));
    unwrap(
      appendCallEntries({
        callId: CALL,
        entries: [segment({ id: "secret", text: "outside secret" })],
        home: outside,
        pid: 101,
        startOf: () => ({ running: true, start: "t101" }),
      }),
    );
    const text = `talk-call:${CALL}#secret`;
    const pointer = unwrap(parseRecallPointer({ text })) as Extract<RecallPointer, { kind: "call" }>;
    expect(unwrap(openDiskRecall({ home: outside, pointer, text })).text).toBe("outside secret");
    mkdirSync(dirname(callsDir({ home })), { recursive: true });
    symlinkSync(callsDir({ home: outside }), callsDir({ home }));
    const failure = unwrapErr(open({ text }));
    expect(failure.code).toBe("RECALL_NOT_FOUND");
    expect(failure.message).not.toContain("outside secret");
    rmSync(outside, { force: true, recursive: true });
  });

  it("says a turn is missing from a call that exists", () => {
    writeCall();
    expect(unwrapErr(open({ text: `talk-call:${CALL}#turn_missing` })).code).toBe("RECALL_NOT_FOUND");
  });
});

// On the e2e marker: recall must not read a walk's owner-role speech back as the owner's own words.
describe("a call the desktop test instance placed", () => {
  const WALK = "a0000041-0000-4000-8000-000000000044";
  const owner = { checkoutRoot: "/w/main", defaultPort: 3000, mainWorktree: true, port: 3000 } as const;

  /** The walk's call: the test instance's open, then the owner's words spoken by the walk. */
  const writeWalk = (): void => {
    unwrap(
      appendCallEntries({
        callId: WALK,
        entries: [
          {
            atIso: "2026-10-08T00:08:00.000Z",
            kind: "open",
            model: "m",
            origin: { ...owner, instance: "e2e" },
            sessionId: "walk",
            voice: "v",
          },
          segment({ id: "walk_turn" }),
        ],
        home,
        pid: 101,
        startOf: () => ({ running: true, start: "t101" }),
      }),
    );
  };

  it("is never a recall hit, while the same words in the owner's own call still are", () => {
    writeCall();
    writeWalk();
    expect(matchesOf(searchCalls({ ...ALL_TIME, home })).map((match) => match.pointer)).toEqual([
      `talk-call:${CALL}#turn_000000000000000000014`,
    ]);
  });

  it("opens no pointer into it", () => {
    writeWalk();
    const pointer = unwrap(parseRecallPointer({ text: `talk-call:${WALK}#walk_turn` }));
    const failure = unwrapErr(
      openDiskRecall({
        home,
        pointer: pointer as Extract<RecallPointer, { kind: "call" }>,
        text: `talk-call:${WALK}#walk_turn`,
      }),
    );
    expect(failure.code).toBe("RECALL_NOT_FOUND");
    expect(failure.message).toContain("which the desktop test placed");
  });
});
