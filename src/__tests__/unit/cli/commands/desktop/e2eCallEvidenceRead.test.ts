import { appendFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  cardReadProgressFromCalls,
  openTypedConversations,
  queueSearchToolCallIds,
  typedBesideSince,
} from "../../../../../cli/commands/desktop/e2eCallEvidenceRead.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { appendCallEntries } from "../../../../../talk/callStore.js";

const SEARCHED = "5b0b8c1e-2f8a-4c7e-9d3a-0e6f4b2a1c01";
const REFUSED = "5b0b8c1e-2f8a-4c7e-9d3a-0e6f4b2a1c02";
const OWNER_CALL = "5b0b8c1e-2f8a-4c7e-9d3a-0e6f4b2a1c03";

const FIND_CARD = {
  atIso: "2026-10-26T11:00:00.000Z",
  detail: "read slopweaver talk find-card",
  kind: "tool" as const,
  name: "verb",
  refused: false,
};

describe("queueSearchToolCallIds", () => {
  let home = "";

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "sw-queue-search-"));
    unwrap(appendCallEntries({ callId: SEARCHED, entries: [FIND_CARD], home }));
    unwrap(appendCallEntries({ callId: REFUSED, entries: [{ ...FIND_CARD, refused: true }], home }));
    unwrap(appendCallEntries({ callId: OWNER_CALL, entries: [FIND_CARD], home }));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("names only the calls it was handed that ran find-card, never the owner's call beside them", () => {
    expect(unwrap(queueSearchToolCallIds({ callIds: [SEARCHED, REFUSED], home }))).toEqual([SEARCHED]);
  });

  it("reads a call with no file yet as one that never searched", () => {
    const unwritten = "5b0b8c1e-2f8a-4c7e-9d3a-0e6f4b2a1c04";
    expect(unwrap(queueSearchToolCallIds({ callIds: [unwritten], home }))).toEqual([]);
  });

  it("reports a call it cannot read, never reading it as none", () => {
    const refused = unwrapErr(queueSearchToolCallIds({ callIds: ["not-a-call-id"], home }));
    expect([refused.code, refused.message]).toEqual([
      "EVIDENCE_UNREADABLE",
      expect.stringContaining("call not-a-call-id"),
    ]);
  });
});

describe("cardReadProgressFromCalls", () => {
  const CARD = "ask:fixture-card";
  const TYPED = "E2E typed abc123: I don't think that is real. What does the card actually claim?";
  const AT = "2026-10-26T11:00:00.000Z";
  const tool = ({ name, detail, refused }: { name: string; detail: string; refused: boolean }) => ({
    atIso: AT,
    detail,
    kind: "tool" as const,
    name,
    refused,
  });
  const segment = ({ id, who, text }: { id: string; who: "owner" | "voice"; text: string }) => ({
    atIso: AT,
    final: true,
    id,
    kind: "segment" as const,
    text,
    who,
  });
  const OPENED = tool({
    detail: `${CARD}, card opened, page none, thread none`,
    name: "open_card",
    refused: false,
  });
  const FIRST = segment({ id: "voice-1", text: "It says the key is a service key.", who: "voice" });
  const CHALLENGE = segment({ id: "typed-in-1", text: TYPED, who: "owner" });
  const READ = tool({ detail: `${CARD}, read`, name: "read_card", refused: false });
  const SECOND = segment({ id: "voice-2", text: "The card claims a service key.", who: "voice" });
  const WRONG = "5b0b8c1e-2f8a-4c7e-9d3a-0e6f4b2a1c05";
  let home = "";

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "sw-card-read-"));
    unwrap(appendCallEntries({ callId: SEARCHED, entries: [OPENED, FIRST, CHALLENGE, READ, SECOND], home }));
    unwrap(
      appendCallEntries({
        callId: REFUSED,
        entries: [OPENED, FIRST, CHALLENGE, { ...READ, refused: true }, SECOND],
        home,
      }),
    );
    unwrap(
      appendCallEntries({
        callId: WRONG,
        entries: [
          tool({ detail: "ask:another-card, card opened, page none, thread none", name: "open_card", refused: false }),
          FIRST,
          CHALLENGE,
          tool({ detail: "ask:another-card, read", name: "read_card", refused: false }),
          SECOND,
        ],
        home,
      }),
    );
    unwrap(appendCallEntries({ callId: OWNER_CALL, entries: [OPENED, FIRST, CHALLENGE, READ, SECOND], home }));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  const read = ({ callIds, cardKey = CARD }: { callIds: readonly string[]; cardKey?: string }) =>
    cardReadProgressFromCalls({ callIds, cardKey, challenge: TYPED, home });

  it("names a hand note's call complete when the card was opened again after the challenge", () => {
    const hand = "hand:acme-sample-note";
    const reopened = "5b0b8c1e-2f8a-4c7e-9d3a-0e6f4b2a1c08";
    const handOpened = tool({
      detail: `${hand}, card opened, page refused, thread none`,
      name: "open_card",
      refused: false,
    });
    unwrap(appendCallEntries({ callId: reopened, entries: [handOpened, FIRST, CHALLENGE, handOpened, SECOND], home }));
    expect(unwrap(read({ callIds: [reopened, SEARCHED], cardKey: hand }))).toEqual({
      completeCallIds: [reopened],
      progress: "complete",
    });
  });

  it("names only a tracked call complete on its own, never the owner's complete call beside it", () => {
    expect(unwrap(read({ callIds: [REFUSED, SEARCHED, WRONG] }))).toEqual({
      completeCallIds: [SEARCHED],
      progress: "complete",
    });
  });

  it("finds no witness in a refused re-read or another card, reporting the furthest call", () => {
    expect(unwrap(read({ callIds: [WRONG, REFUSED] }))).toEqual({
      completeCallIds: [],
      progress: "waiting-for-reread",
    });
  });

  it("never joins two incomplete calls into one witness", () => {
    const opened = "5b0b8c1e-2f8a-4c7e-9d3a-0e6f4b2a1c06";
    const reread = "5b0b8c1e-2f8a-4c7e-9d3a-0e6f4b2a1c07";
    unwrap(appendCallEntries({ callId: opened, entries: [OPENED, FIRST], home }));
    unwrap(appendCallEntries({ callId: reread, entries: [CHALLENGE, READ, SECOND], home }));
    expect(unwrap(read({ callIds: [opened, reread] }))).toEqual({
      completeCallIds: [],
      progress: "ready-for-challenge",
    });
  });

  it("reports a call it cannot read, never reading it as no witness", () => {
    const refused = unwrapErr(read({ callIds: ["not-a-call-id"] }));
    expect([refused.code, refused.message]).toEqual([
      "EVIDENCE_UNREADABLE",
      expect.stringContaining("call not-a-call-id"),
    ]);
  });
});

describe("the call store's typed conversations", () => {
  const AT = new Date("2026-10-26T11:00:00.000Z");
  const NOW_MS = AT.getTime() + 60_000;
  const OPEN = { atIso: AT.toISOString(), kind: "open" as const, model: "m", sessionId: "s", voice: "none" };
  let home = "";

  /** Write one call's entries, its file stamped at {@link AT} so the read window holds it. */
  const written = ({
    callId,
    entries,
  }: {
    callId: string;
    entries: Parameters<typeof appendCallEntries>[0]["entries"];
  }) => {
    unwrap(appendCallEntries({ callId, entries, home }));
    utimesSync(join(home, "talk", "calls", `${callId}.jsonl`), AT, AT);
  };

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "sw-typed-open-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("names the owner's conversation opened after the clear read though its close never landed, never the test's own", () => {
    const clearReadMs = AT.getTime() - 1000;
    const nonce = "E2E typed abc123";
    written({ callId: OWNER_CALL, entries: [{ ...OPEN, surface: "typed" }] });
    written({
      callId: SEARCHED,
      entries: [
        { ...OPEN, surface: "typed" },
        {
          atIso: AT.toISOString(),
          beganIso: AT.toISOString(),
          final: true,
          id: "typed-heard-1",
          kind: "segment",
          text: `${nonce}: is there a card`,
          who: "owner",
        },
      ],
    });
    expect(unwrap(typedBesideSince({ clearReadMs, home, ownerText: nonce }))).toEqual({
      beside: [OWNER_CALL],
      unread: [],
    });
  });

  it("judges recency by when a file was written, never its lines' stamps, in both reads", () => {
    const stale = new Date(AT.getTime() - 2 * 60 * 60_000).toISOString();
    written({ callId: OWNER_CALL, entries: [{ ...OPEN, atIso: stale, surface: "typed" }] });
    const old = new Date(NOW_MS - 30 * 60_000 - 1000);
    unwrap(appendCallEntries({ callId: REFUSED, entries: [{ ...OPEN, surface: "typed" }], home }));
    utimesSync(join(home, "talk", "calls", `${REFUSED}.jsonl`), old, old);
    expect([
      unwrap(openTypedConversations({ home, nowMs: NOW_MS })),
      unwrap(typedBesideSince({ clearReadMs: AT.getTime() - 1000, home, ownerText: "E2E typed abc123" })).beside,
    ]).toEqual([[OWNER_CALL], [OWNER_CALL]]);
  });

  it("refuses the open read on a call file with a line it skipped, which may hide a typed open", () => {
    written({ callId: OWNER_CALL, entries: [{ atIso: AT.toISOString(), kind: "closed", why: null }] });
    appendFileSync(join(home, "talk", "calls", `${OWNER_CALL}.jsonl`), '{"kind":"open","atIso":\n');
    utimesSync(join(home, "talk", "calls", `${OWNER_CALL}.jsonl`), AT, AT);
    const refused = unwrapErr(openTypedConversations({ home, nowMs: NOW_MS }));
    expect([refused.code, refused.message]).toEqual([
      "EVIDENCE_UNREADABLE",
      expect.stringContaining(`call ${OWNER_CALL} has a line that could not be parsed`),
    ]);
  });

  it("names the owner's conversation beside a torn file and an unreadable one, never hiding it behind them", () => {
    written({ callId: OWNER_CALL, entries: [{ ...OPEN, surface: "typed" }] });
    written({ callId: REFUSED, entries: [{ atIso: AT.toISOString(), kind: "closed", why: null }] });
    appendFileSync(join(home, "talk", "calls", `${REFUSED}.jsonl`), '{"kind":"open","atIso":\n');
    utimesSync(join(home, "talk", "calls", `${REFUSED}.jsonl`), AT, AT);
    mkdirSync(join(home, "talk", "calls", `${SEARCHED}.jsonl`));
    const read = unwrap(typedBesideSince({ clearReadMs: 0, home, ownerText: "E2E typed abc123" }));
    expect([read.beside, read.unread.length, read.unread.join("; ")]).toEqual([
      [OWNER_CALL],
      2,
      expect.stringContaining(`call ${REFUSED} has a line that could not be parsed`),
    ]);
    expect(read.unread.join("; ")).toContain(SEARCHED);
  });

  it("names the owner's unended typed conversation and passes over an ended one and a voice call", () => {
    written({ callId: SEARCHED, entries: [{ ...OPEN, surface: "typed" }] });
    written({
      callId: REFUSED,
      entries: [
        { ...OPEN, surface: "typed" },
        { atIso: AT.toISOString(), kind: "closed", why: null },
      ],
    });
    written({ callId: OWNER_CALL, entries: [{ ...OPEN, surface: "voice" }] });
    expect(unwrap(openTypedConversations({ home, nowMs: NOW_MS }))).toEqual([SEARCHED]);
  });

  it("refuses when a call file cannot be read, never reading it as no conversation open", () => {
    written({ callId: OWNER_CALL, entries: [{ ...OPEN, surface: "voice" }] });
    mkdirSync(join(home, "talk", "calls", `${SEARCHED}.jsonl`));
    const refused = unwrapErr(openTypedConversations({ home, nowMs: NOW_MS }));
    expect([refused.code, refused.message]).toEqual(["EVIDENCE_UNREADABLE", expect.stringContaining(SEARCHED)]);
  });
});
