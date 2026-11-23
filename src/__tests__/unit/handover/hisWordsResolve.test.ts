/*
 * Reading the owner's words off the record an anchor names. A relay turn is claimed into a throwaway home by the real
 * store, so what is read back is what `talk` actually writes — `heard` quoted, the voice's own `words` never.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveHisWords, resolveRawWords } from "../../../handover/hisWordsResolve.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";
import { OWNER_SPEAKER } from "../../../talk/callRecord.js";
import type { CardLandedRow } from "../../../talk/cardLanding.js";
import { appendCardLanding } from "../../../talk/cardLandingStore.js";
import { formRelayDraft } from "../../../talk/relayDraft.js";
import { RELAY_ROW_QUOTE_LIMIT } from "../../../talk/relayRowQuote.js";
import { claimTurn } from "../../../talk/relayStore.js";
import type { TriageRuling } from "../../../talk/triageVocabulary.js";

const TURN = "a0000015-0000-4000-8000-000000000016";
const STAGED = "2026-09-28T06:03:54.584Z";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "owner-words-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

function relay({
  about = "",
  heard,
  heardTailCut,
  triageRuling,
  typed,
}: {
  about?: string;
  heard: string;
  heardTailCut?: boolean;
  triageRuling?: TriageRuling;
  typed: boolean;
}): void {
  const draft = unwrap(
    formRelayDraft({
      about,
      heard,
      heardTailCut,
      picture: { kind: "none", reason: "screen-not-shared" },
      readsAfter: [],
      say: typed ? "" : "the voice's paraphrase, never quoted",
      triageRuling,
      turnId: TURN,
      typed,
      wordsAlone: false,
    }),
  );
  unwrap(claimTurn({ draft, home, nowIso: STAGED }));
}

/** The turn file {@link relay} wrote, as stored JSON. */
function storedTurn(): { path: string; record: Record<string, unknown> } {
  const path = join(stateHomePaths({ home }).talkTurns, `${TURN}.json`);
  return { path, record: JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown> };
}

/** The raw words at the relay's anchor. */
function rawAtRelay(): ReturnType<typeof resolveRawWords> {
  return resolveRawWords({ anchor: `talk:${TURN}`, home, projectsDir: join(home, "projects") });
}

function resolve({ anchor }: { anchor: string }): ReturnType<typeof resolveHisWords> {
  return resolveHisWords({ anchor, home, projectsDir: join(home, "projects") });
}

describe("resolveRawWords", () => {
  it("returns the record's whole text, past the excerpt a row stores, and says the record kept all of it", () => {
    // Past HIS_WORDS_MAX (1,500), inside the 2,000 a typed relay carries.
    const heard = `${"word ".repeat(360)}the end`;
    relay({ heard, typed: true });

    const raw = unwrap(resolveRawWords({ anchor: `talk:${TURN}`, home, projectsDir: join(home, "projects") }));

    expect(raw).toEqual({
      atIso: STAGED,
      context: { about: "", kind: "relay", triageRuling: null },
      headKnown: true,
      headLost: false,
      tailKnown: true,
      tailLost: false,
      text: heard,
      where: "console-typed",
    });
  });

  // The needs-more-info verdict lived only in the row's prose, so no verb read it.
  it("carries the triage ruling and card the relay recorded, off the same turn file its words came from", () => {
    relay({
      about: "post:sd-ffab16e8",
      heard: "Yes, of course",
      triageRuling: { label: undefined, verdict: "needs-more-info" },
      typed: false,
    });

    expect(storedTurn().record["triageRuling"]).toEqual({ verdict: "needs-more-info" });
    expect(unwrap(rawAtRelay()).context).toEqual({
      about: "post:sd-ffab16e8",
      kind: "relay",
      triageRuling: { label: undefined, verdict: "needs-more-info" },
    });
  });

  it("reads a relay written before rulings were stored as UNKNOWN, never as one that carried none", () => {
    relay({ heard: "Yes, of course", typed: false });
    const { path, record } = storedTurn();
    const { triageRuling: _dropped, ...older } = record;
    writeFileSync(path, JSON.stringify(older), "utf8");

    expect(record["triageRuling"]).toBe(null);
    expect(unwrap(rawAtRelay()).context).toEqual({ about: "", kind: "relay", triageRuling: undefined });
  });

  it("refuses a relay whose stored ruling does not read, rather than reading it as none", () => {
    relay({ heard: "Yes, of course", typed: false });
    const { path, record } = storedTurn();
    writeFileSync(path, JSON.stringify({ ...record, triageRuling: { verdict: "ship-it" } }), "utf8");

    expect(unwrapErr(rawAtRelay()).code).toBe("RECORD_UNREADABLE");
  });

  it("carries the card a call stretch began over", () => {
    const call = "a0000037-0000-4000-8000-000000000040";
    mkdirSync(join(home, "talk", "calls"), { recursive: true });
    writeFileSync(
      join(home, "talk", "calls", `${call}.jsonl`),
      `${JSON.stringify({ atIso: "2026-09-01T13:48:00.000Z", final: true, id: "s-1", kind: "segment", open: "post:sd-0a0b0c0d", text: "send it", who: "owner" })}\n`,
    );

    const raw = unwrap(resolveRawWords({ anchor: `talk-call:${call}#s-1`, home, projectsDir: join(home, "projects") }));

    expect(raw.context).toEqual({ kind: "call-segment", open: "post:sd-0a0b0c0d" });
  });

  // "yes, send it" then an unfinished "actually, don't" is one run, over a card or with none open.
  it("reads a final stretch as cut when a later stretch of its run is unfinished, card open or not", () => {
    const call = "a0000037-c03e-4c6b-95fb-9e0a4b3c2d67";
    const line = ({
      at,
      final,
      id,
      open,
      text,
    }: {
      at: string;
      final: boolean;
      id: string;
      open: string | undefined;
      text: string;
    }): string =>
      JSON.stringify({ atIso: `2026-09-01T13:${at}.000Z`, final, id, kind: "segment", open, text, who: OWNER_SPEAKER });
    const tailLostOf = ({ lines }: { lines: readonly string[] }): boolean => {
      mkdirSync(join(home, "talk", "calls"), { recursive: true });
      writeFileSync(join(home, "talk", "calls", `${call}.jsonl`), `${lines.join("\n")}\n`);
      return unwrap(resolveRawWords({ anchor: `talk-call:${call}#s-1`, home, projectsDir: join(home, "projects") }))
        .tailLost;
    };
    const runOf = ({ open }: { open: string | undefined }): readonly string[] => [
      line({ at: "48:00", final: true, id: "s-1", open, text: "yes, send it" }),
      line({ at: "48:02", final: false, id: "s-2", open, text: "actually, don't" }),
    ];

    expect([
      tailLostOf({ lines: runOf({ open: "post:sd-0a0b0c0d" }) }),
      tailLostOf({ lines: runOf({ open: undefined }) }),
      tailLostOf({ lines: runOf({ open: undefined }).slice(0, 1) }),
    ]).toEqual([true, true, false]);
  });

  // A seat's witness console lands `who: "owner"` speech in the owner's home, begun there or
  // finishing a stretch begun on the owner's; `talk unread` sets it aside.
  it("refuses a stretch any line of which a console that is not the owner's recorded, and keeps one recorded on the owner's", () => {
    const call = "a0000037-c03e-4c6b-95fb-9e0a4b3c2d66";
    const open = ({ port }: { port: number }): string =>
      JSON.stringify({
        atIso: "2026-10-12T04:59:00.000Z",
        kind: "open",
        model: "m",
        origin: { checkoutRoot: "/repo", defaultPort: 3000, mainWorktree: true, port },
        sessionId: "s",
        voice: "v",
      });
    const said = ({ final = true, id, text = "send it" }: { final?: boolean; id: string; text?: string }): string =>
      JSON.stringify({ atIso: "2026-10-12T05:00:00.000Z", final, id, kind: "segment", text, who: "owner" });
    const lines = [
      open({ port: 3000 }),
      said({ id: "owners" }),
      said({ final: false, id: "finished-elsewhere", text: "ye" }),
      open({ port: 3001 }),
      said({ id: "seat" }),
      said({ id: "finished-elsewhere", text: "yes, send it" }),
    ];
    mkdirSync(join(home, "talk", "calls"), { recursive: true });
    writeFileSync(join(home, "talk", "calls", `${call}.jsonl`), `${lines.join("\n")}\n`);
    const at = ({ id }: { id: string }): ReturnType<typeof resolveRawWords> =>
      resolveRawWords({ anchor: `talk-call:${call}#${id}`, home, projectsDir: join(home, "projects") });
    const seat =
      "the owner's main checkout at /repo on :3001 (the owner's console is :3000), so its speech is not read as the owner's";

    expect([
      unwrapErr(at({ id: "seat" })).message,
      unwrapErr(at({ id: "finished-elsewhere" })).message,
      unwrap(at({ id: "owners" })).text,
    ]).toEqual([
      `talk-call:${call}#seat was recorded on ${seat}`,
      `talk-call:${call}#finished-elsewhere was recorded on ${seat}`,
      "send it",
    ]);
  });

  // The skipped line was the open stamping a seat's console, so the stretch read as unstamped.
  it("refuses a stretch it found when another line of the call does not parse", () => {
    const call = "a0000037-c03e-4c6b-95fb-9e0a4b3c2d67";
    mkdirSync(join(home, "talk", "calls"), { recursive: true });
    writeFileSync(
      join(home, "talk", "calls", `${call}.jsonl`),
      `${JSON.stringify({ atIso: "2026-10-12T04:59:00.000Z", kind: "open", model: 42, origin: { checkoutRoot: "/repo", defaultPort: 3000, mainWorktree: true, port: 3001 }, sessionId: "s", voice: "v" })}\n${JSON.stringify({ atIso: "2026-10-12T05:00:00.000Z", final: true, id: "seat", kind: "segment", text: "yes, send it", who: "owner" })}\n`,
    );

    const refused = unwrapErr(
      resolveRawWords({ anchor: `talk-call:${call}#seat`, home, projectsDir: join(home, "projects") }),
    );

    expect([refused.code, refused.message]).toEqual([
      "RECORD_UNREADABLE",
      `talk-call:${call}#seat could not be read — 1 line(s) of the call do not parse, so whose console recorded it is unknown`,
    ]);
  });

  it("refuses a stretch when a line of its call carries a card stamp that does not read", () => {
    const call = "a0000037-c03e-4c6b-95fb-9e0a4b3c2d68";
    mkdirSync(join(home, "talk", "calls"), { recursive: true });
    const stretch = { atIso: "2026-10-12T05:00:00.000Z", final: true, id: "seat", kind: "segment", who: OWNER_SPEAKER };
    const lines = [
      { ...stretch, text: "yes, send it" },
      { ...stretch, final: false, id: "next", open: "?", text: "but" },
    ];
    writeFileSync(
      join(home, "talk", "calls", `${call}.jsonl`),
      `${lines.map((one) => JSON.stringify(one)).join("\n")}\n`,
    );

    const refused = unwrapErr(
      resolveRawWords({ anchor: `talk-call:${call}#seat`, home, projectsDir: join(home, "projects") }),
    );

    expect(refused.message).toBe(
      `talk-call:${call}#seat could not be read — 1 stretch(es) of the call carry a stamp that does not read, so whether its words were cut is unknown`,
    );
  });

  it("says a relay written before it stored whether it kept only the tail does not say", () => {
    relay({ heard: "an older relay", typed: false });
    const path = join(stateHomePaths({ home }).talkTurns, `${TURN}.json`);
    const { heardTruncated: _dropped, ...older } = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    writeFileSync(path, JSON.stringify(older), "utf8");

    const raw = unwrap(resolveRawWords({ anchor: `talk:${TURN}`, home, projectsDir: join(home, "projects") }));

    expect([raw.headKnown, raw.headLost, raw.text]).toEqual([false, false, "an older relay"]);
  });

  // A relay made while the owner's stretch was still open was read as whole words.
  it("says a relay made mid-sentence lost its tail, and one made after the stretch finished kept it", () => {
    relay({ heard: "yes send it but", heardTailCut: true, typed: false });
    const cut = unwrap(rawAtRelay());
    rmSync(stateHomePaths({ home }).talkTurns, { force: true, recursive: true });
    relay({ heard: "yes send it", heardTailCut: false, typed: false });
    const whole = unwrap(rawAtRelay());

    expect(storedTurn().record["heardTailCut"]).toBe(false);
    expect([cut.tailKnown, cut.tailLost, whole.tailKnown, whole.tailLost]).toEqual([true, true, true, false]);
  });

  it("says a voice relay that never stated whether the owner was still speaking does not say, and a typed one does", () => {
    relay({ heard: "an older relay", typed: false });
    const spoken = unwrap(rawAtRelay());
    rmSync(stateHomePaths({ home }).talkTurns, { force: true, recursive: true });
    relay({ heard: "typed", typed: true });
    const typed = unwrap(rawAtRelay());

    expect(storedTurn().record["heardTailCut"]).toBe(false);
    expect([spoken.tailKnown, spoken.tailLost, typed.tailKnown, typed.tailLost]).toEqual([false, false, true, false]);
  });
});

describe("resolveHisWords", () => {
  it("quotes what the owner said to the console voice, never the voice's paraphrase", () => {
    relay({ heard: "put the quote,\nlarge, on the card", typed: false });
    expect(unwrap(resolve({ anchor: `talk:${TURN}` }))).toEqual({
      anchor: `talk:${TURN}`,
      cut: "none",
      atIso: STAGED,
      where: "console-voice",
      words: "put the quote, large, on the card",
    });
  });

  it("says typed only when the turn records it was typed", () => {
    relay({ heard: "typed this", typed: true });
    expect(unwrap(resolve({ anchor: `talk:${TURN}` })).where).toBe("console-typed");
  });

  // The record kept the row's 1,500-character tail and the owner's head was lost.
  it("reads every word of a long spoken turn off its record, past the row's quote, with nothing cut", () => {
    const heard = `the start ${"a ".repeat(RELAY_ROW_QUOTE_LIMIT)}the end`;
    relay({ heard, typed: false });
    const raw = unwrap(resolveRawWords({ anchor: `talk:${TURN}`, home, projectsDir: join(home, "projects") }));
    expect(raw).toEqual({
      atIso: STAGED,
      context: { about: "", kind: "relay", triageRuling: null },
      headKnown: true,
      headLost: false,
      tailKnown: false,
      tailLost: false,
      text: heard,
      where: "console-voice",
    });
  });

  // An accepted prompt suggestion is Claude Code's text, which the owner only accepted.
  it("quotes a session turn the owner typed, and refuses one Claude Code suggested and the owner accepted", () => {
    const session = "29b5a8a6-2f6e-4b95-a16e-5092d762a399";
    const typed = "a0000005-0000-4000-8000-000000000005";
    const suggested = "77ecdee3-70e8-4d7c-8409-863b20234676";
    const line = ({ uuid, text, promptSource }: { uuid: string; text: string; promptSource: string }): string =>
      JSON.stringify({
        cwd: "/repo",
        message: { content: [{ text, type: "text" }], role: "user" },
        promptSource,
        timestamp: "2026-09-01T13:47:00.000Z",
        type: "user",
        uuid,
      });
    mkdirSync(join(home, "projects", "-repo"), { recursive: true });
    writeFileSync(
      join(home, "projects", "-repo", `${session}.jsonl`),
      `${line({ promptSource: "typed", text: "ship it", uuid: typed })}\n${line({ promptSource: "suggestion_accepted", text: "back from the nap, brief me", uuid: suggested })}\n`,
    );
    expect([
      unwrap(resolve({ anchor: `transcript:${session}#${typed}` })).words,
      unwrapErr(resolve({ anchor: `transcript:${session}#${suggested}` })).code,
    ]).toEqual(["ship it", "TURN_NOT_TYPED"]);
  });

  // An unclosed wrapper takes the rest of the turn, so the quote is short of the
  // record and says so; the edge trim is Unicode White_Space only, so a U+FEFF the owner typed stays in the owner's words.
  it("marks a session turn an unclosed wrapper cut as cut at its end, and keeps an edge U+FEFF", () => {
    const session = "5c1e7a44-9d0b-4f3e-a2c8-6b7d1e0f9a31";
    const unclosed = "a4b3c2d1-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
    const feff = "b5c4d3e2-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
    const line = ({ uuid, text }: { uuid: string; text: string }): string =>
      JSON.stringify({
        cwd: "/repo",
        message: { content: [{ text, type: "text" }], role: "user" },
        promptSource: "typed",
        timestamp: "2026-09-01T13:47:00.000Z",
        type: "user",
        uuid,
      });
    mkdirSync(join(home, "projects", "-repo"), { recursive: true });
    writeFileSync(
      join(home, "projects", "-repo", `${session}.jsonl`),
      `${line({ text: "the <command-name> wrapper is fine", uuid: unclosed })}\n${line({ text: "﻿ship it", uuid: feff })}\n`,
    );
    const cutShort = unwrap(resolve({ anchor: `transcript:${session}#${unclosed}` }));
    const kept = unwrap(resolve({ anchor: `transcript:${session}#${feff}` }));
    expect([cutShort.words, cutShort.cut, kept.words, kept.cut]).toEqual(["the", "end", "﻿ship it", "none"]);
  });

  // A span cut from between the owner's words joins text the record kept apart, while a
  // reminder riding after them is cut clean; a queued turn keeps an edge U+FEFF the way a typed one does.
  it("refuses a turn a wrapper span was cut from the middle of, quotes one it rode beside, and keeps a queued U+FEFF", () => {
    const session = "6d2f8b55-ae1c-4a4f-b3d9-7c8e2f1a0b42";
    const middle = "c6d5e4f3-a7b8-4c9d-8e0f-2a3b4c5d6e7f";
    const trailing = "d7e6f5a4-b8c9-4d0e-9f1a-3b4c5d6e7f80";
    const queued = "e8f7a6b5-c9d0-4e1f-8a2b-4c5d6e7f8091";
    const line = ({ uuid, text }: { uuid: string; text: string }): string =>
      JSON.stringify({
        cwd: "/repo",
        message: { content: [{ text, type: "text" }], role: "user" },
        promptSource: "typed",
        timestamp: "2026-09-01T13:47:00.000Z",
        type: "user",
        uuid,
      });
    const queuedLine = JSON.stringify({
      attachment: { commandMode: "prompt", origin: { kind: "human" }, prompt: "﻿ship it", type: "queued_command" },
      cwd: "/repo",
      timestamp: "2026-09-01T13:48:00.000Z",
      type: "attachment",
      uuid: queued,
    });
    mkdirSync(join(home, "projects", "-repo"), { recursive: true });
    writeFileSync(
      join(home, "projects", "-repo", `${session}.jsonl`),
      [
        line({ text: "why does <bash-input>ls</bash-input> show up on the card", uuid: middle }),
        line({ text: "ship it\n<system-reminder>a reminder</system-reminder>", uuid: trailing }),
        queuedLine,
        "",
      ].join("\n"),
    );
    expect([
      unwrapErr(resolve({ anchor: `transcript:${session}#${middle}` })).code,
      unwrap(resolve({ anchor: `transcript:${session}#${trailing}` })).words,
      unwrap(resolve({ anchor: `transcript:${session}#${queued}` })).words,
    ]).toEqual(["TURN_SPLICED", "ship it", "﻿ship it"]);
  });

  // What a card quotes as the owner's must be proven the owner's, and a stretch still growing is quoted as cut.
  it("refuses a session turn with no promptSource, and quotes a non-final call stretch as cut at its end", () => {
    const session = "7e3a9c66-bf2d-4b5a-84ea-8d9f3a2b1c53";
    const unproven = "f9a8b7c6-d0e1-4f2a-9b3c-5d6e7f8091a2";
    mkdirSync(join(home, "projects", "-repo"), { recursive: true });
    writeFileSync(
      join(home, "projects", "-repo", `${session}.jsonl`),
      `${JSON.stringify({
        cwd: "/repo",
        message: { content: [{ text: "ship it", type: "text" }], role: "user" },
        timestamp: "2026-09-01T13:47:00.000Z",
        type: "user",
        uuid: unproven,
      })}\n`,
    );
    const call = "a0000037-c03e-4c6b-95fb-9e0a4b3c2d64";
    mkdirSync(join(home, "talk", "calls"), { recursive: true });
    writeFileSync(
      join(home, "talk", "calls", `${call}.jsonl`),
      `${JSON.stringify({ atIso: "2026-09-01T13:48:00.000Z", final: false, id: "s-1", kind: "segment", text: "move it", who: "owner" })}\n`,
    );

    const segment = unwrap(resolve({ anchor: `talk-call:${call}#s-1` }));

    expect([
      unwrapErr(resolve({ anchor: `transcript:${session}#${unproven}` })).code,
      segment.words,
      segment.cut,
    ]).toEqual(["TURN_UNPROVEN", "move it", "end"]);
  });

  it("refuses a relay turn that holds nothing the owner said", () => {
    relay({ heard: "", typed: false });
    expect(unwrapErr(resolve({ anchor: `talk:${TURN}` })).code).toBe("WORDS_EMPTY");
  });

  it("names a relay turn that is not there as missing, and one that will not parse as unreadable", () => {
    const missing = unwrapErr(resolve({ anchor: `talk:${TURN}` })).code;
    mkdirSync(join(home, "talk", "turns"), { recursive: true });
    writeFileSync(join(home, "talk", "turns", `${TURN}.json`), "{torn");
    expect([missing, unwrapErr(resolve({ anchor: `talk:${TURN}` })).code]).toEqual([
      "RECORD_MISSING",
      "RECORD_UNREADABLE",
    ]);
  });

  it("refuses a malformed pointer before reading anything", () => {
    expect([
      unwrapErr(resolve({ anchor: "talk:not a turn" })).code,
      unwrapErr(resolve({ anchor: "transcript:handoff-doc#turn-3" })).code,
      unwrapErr(resolve({ anchor: "talk-call:nohash" })).code,
    ]).toEqual(["ANCHOR_MALFORMED", "ANCHOR_MALFORMED", "ANCHOR_MALFORMED"]);
  });

  it("refuses an anchor that names no record of the owner's words", () => {
    expect(unwrapErr(resolve({ anchor: "https://x.slack.com/archives/C1/p1" })).code).toBe("NOT_OWNER_SCHEME");
  });

  // `talk land` checks a session's words against the call file only for a segment
  // anchor, so a landing under any other call: anchor carries the session's words, never the owner's.
  it("refuses a call: anchor naming no segment, even with a landing under it", () => {
    const anchor = "call:a0000041-0000-4000-8000-000000000044";
    const landed: CardLandedRow = {
      anchor,
      atIso: "2026-09-28T09:01:00.000Z",
      cardKey: "hand:some-step",
      decidedIso: "2026-09-28T09:00:00.000Z",
      kind: "landed",
      source: "session",
      words: "a session's own paraphrase, never said",
      workSlug: "talk-card-f49cfa82b2aa",
    };
    unwrap(appendCardLanding({ home, row: landed }));
    expect(unwrapErr(resolve({ anchor })).code).toBe("ANCHOR_MALFORMED");
  });

  it("names a card landing that is not in the ledger as missing", () => {
    expect(unwrapErr(resolve({ anchor: "call:c1#1" })).code).toBe("RECORD_MISSING");
  });
});
