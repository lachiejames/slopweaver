/*
 * The console window's failure toasts: which final outcome
 * earns one, that every one is its own toast, and that a card that did not open carries its key for "Open in
 * browser". Pure — every instant is passed in.
 */
import { describe, expect, it } from "vitest";

import { NOTICE_WIRE_DETAIL_MAX, voiceFailureNoticeWireOf } from "../../lib/desktopShell";
import {
  dismissToast,
  expireToasts,
  NO_TOASTS,
  NOTICE_DETAIL_MAX,
  NOTICE_TOOL_MAX,
  nextExpiryMs,
  receiveNotice,
  shownToasts,
  TOAST_LIFE_MS,
  type VoiceFailureNotice,
  type VoiceFailureToastState,
  voiceFailureNoticeOf,
} from "../../lib/voiceFailureToast";

const NOTHING_HELD: ReadonlySet<number> = new Set();

/** The measured call's own failure: the card's panel refused, the call still answered with the card. */
const CARD_REFUSED = {
  detail: "ask:queue-shows-raw-user-id, card refused, page none, thread none",
  kind: "tool",
  partialFailures: [
    { cardKey: "ask:queue-shows-raw-user-id", part: "card", why: "only the voice's window may show a Queue card" },
  ],
  refused: false,
  tool: "open_card",
} as const;

const notice = ({ name, detail = "why" }: { name: string; detail?: string }): VoiceFailureNotice => ({
  detail,
  summary: `failed ${name}`,
});

/**
 * The stack after each notice, in order, all at one instant.
 *
 * @returns the stack
 */
const received = ({ notices, nowMs = 0 }: { notices: readonly VoiceFailureNotice[]; nowMs?: number }) =>
  notices.reduce<VoiceFailureToastState>((state, one) => receiveNotice({ notice: one, nowMs, state }), NO_TOASTS);

describe("voiceFailureNoticeOf", () => {
  it("bounds an unknown tool's name so the notice still crosses the wire", () => {
    const tool = "x".repeat(250);
    const raised = voiceFailureNoticeOf({
      outcome: { detail: `no tool named ${tool}`, kind: "tool", partialFailures: [], refused: true, tool },
    });
    const bounded = `${"x".repeat(NOTICE_TOOL_MAX - 1)}…`;
    expect(raised!.summary).toBe(`The voice's ${bounded} failed`);
    expect(voiceFailureNoticeWireOf({ value: raised })).toEqual(raised);
  });

  it("names an unknown tool called `constructor` rather than reading the object prototype", () => {
    const raised = voiceFailureNoticeOf({
      outcome: {
        detail: "no tool named constructor",
        kind: "tool",
        partialFailures: [],
        refused: true,
        tool: "constructor",
      },
    });
    expect(raised).toStrictEqual({ detail: "no tool named constructor", summary: "The voice's constructor failed" });
    expect(voiceFailureNoticeWireOf({ value: raised })).toEqual(raised);
  });

  it("raises the measured failure with the card's key, so its toast can open that card in the owner's browser", () => {
    const raised = voiceFailureNoticeOf({ outcome: CARD_REFUSED });
    expect(raised).toStrictEqual({
      cardKey: "ask:queue-shows-raw-user-id",
      detail: "only the voice's window may show a Queue card",
      summary: "The voice couldn't open the card's panel",
    });
    expect(voiceFailureNoticeWireOf({ value: raised })).toStrictEqual(raised);
  });

  // The toast reads its detail as a failure's raw message, so the call's own line never rides in it.
  it("carries only the refused openings' reasons, one line each, never the call's own activity line", () => {
    const outcome = {
      ...CARD_REFUSED,
      partialFailures: [
        { cardKey: "ask:x", part: "card", why: "a" },
        { cardKey: "ask:x", part: "page", why: "b" },
      ],
    };
    expect(voiceFailureNoticeOf({ outcome })!.detail).toBe("card: a\npage: b");
  });

  it("names how many more openings were refused beside the first", () => {
    const outcome = {
      ...CARD_REFUSED,
      partialFailures: [
        { cardKey: "ask:x", part: "card", why: "a" },
        { cardKey: "ask:x", part: "page", why: "b" },
        { cardKey: "ask:x", part: "thread", why: "c" },
      ],
    };
    expect(voiceFailureNoticeOf({ outcome })!.summary).toBe("The voice couldn't open the card's panel (and 2 more)");
  });

  // A briefing the voice could not read is said, and shown, never agreed around.
  it("names a briefing the card's read could not take in whole", () => {
    const outcome = {
      ...CARD_REFUSED,
      partialFailures: [{ cardKey: "ask:x", part: "briefing", why: "orb-notes: ENOENT" }],
    };
    expect(voiceFailureNoticeOf({ outcome })!.summary).toBe("The voice couldn't open all of the card's briefing");
  });

  it("carries no card key on another tool's refused opening, since only open_card resolves a card", () => {
    const raised = voiceFailureNoticeOf({ outcome: { ...CARD_REFUSED, tool: "read_card" } });
    expect(raised!.cardKey).toBe(undefined);
    expect(Object.keys(raised!).toSorted()).toEqual(["detail", "summary"]);
  });

  it("raises nothing for a call that ran and refused nothing", () => {
    const outcome = { ...CARD_REFUSED, detail: "ask:x, card opened", partialFailures: [] };
    expect(voiceFailureNoticeOf({ outcome })).toBe(undefined);
  });

  it("raises a refused tool by its own line and no card, a malformed call included", () => {
    const outcome = { detail: "no key", kind: "tool", partialFailures: [], refused: true, tool: "open_card" } as const;
    expect(voiceFailureNoticeOf({ outcome })).toStrictEqual({
      detail: "no key",
      summary: "The voice couldn't open the card",
    });
  });

  it("raises a refused copy-tray offer by its own line", () => {
    const outcome = {
      detail: "no call up",
      kind: "tool",
      partialFailures: [],
      refused: true,
      tool: "offer_copy",
    } as const;
    expect(voiceFailureNoticeOf({ outcome })).toStrictEqual({
      detail: "no call up",
      summary: "The voice couldn't put that on your running list",
    });
  });

  it("raises a refused meeting skip by its own line, so the owner knows the join reminder still stands", () => {
    const detail = "the owner has said nothing on this call yet: a meeting is only skipped on their own words";
    const outcome = { detail, kind: "tool", partialFailures: [], refused: true, tool: "meeting_skip" } as const;
    expect(voiceFailureNoticeOf({ outcome })).toStrictEqual({
      detail,
      summary: "The voice couldn't stop the join reminder for that meeting",
    });
  });

  it("names a refused tool it has no line for", () => {
    const outcome = { detail: "exited 1", kind: "tool", partialFailures: [], refused: true, tool: "glossary" } as const;
    expect(voiceFailureNoticeOf({ outcome })!.summary).toBe("The voice's glossary failed");
  });

  // The toast folds the reason as the full message, so it is never flattened nor cut early.
  it("keeps a reason exactly as given, its lines and spacing whole, and it still crosses the wire", () => {
    const detail = "Error: open failed\n    at browserOpen (talk.ts:12:5)\t  trailing  ";
    const outcome = { detail, kind: "tool", partialFailures: [], refused: true, tool: "browser_open" } as const;
    const raised = voiceFailureNoticeOf({ outcome });
    expect(raised).toStrictEqual({ detail, summary: "The voice couldn't open that page" });
    expect(voiceFailureNoticeWireOf({ value: raised })).toStrictEqual(raised);
  });

  it("bounds a reason only at the wire's own bound, keeping its head", () => {
    const at = "x".repeat(NOTICE_DETAIL_MAX);
    const over = `line one\n${"x".repeat(NOTICE_DETAIL_MAX)}`;
    const [kept, cut] = [at, over].map(
      (detail) =>
        voiceFailureNoticeOf({
          outcome: { detail, kind: "tool", partialFailures: [], refused: true, tool: "browser_open" },
        })!.detail,
    );
    expect([NOTICE_DETAIL_MAX, kept === at, cut.length, cut.startsWith("line one\nxx"), cut.endsWith("x…")]).toEqual([
      NOTICE_WIRE_DETAIL_MAX,
      true,
      NOTICE_DETAIL_MAX,
      true,
      true,
    ]);
  });

  // A relay failure needs no report to the owner.
  it("raises nothing for a refused relay_steer — the relay is journalled, never toasted — while a sibling still is", () => {
    const relay = { detail: "the gate shut", kind: "tool", partialFailures: [], refused: true, tool: "relay_steer" };
    const sibling = { ...relay, tool: "read_screen" };
    expect([
      voiceFailureNoticeOf({ outcome: { ...relay, kind: "tool" } }),
      voiceFailureNoticeOf({ outcome: { ...sibling, kind: "tool" } })!.summary,
    ]).toEqual([undefined, "The voice couldn't look at your screen"]);
  });
});

describe("the toast stack", () => {
  // Five of five failures raise five toasts, never one counted.
  it("gives five of the same failure five toasts, each with its own id and its own detail", () => {
    const notices = [0, 1, 2, 3, 4].map((at) => notice({ detail: `why ${String(at)}`, name: "open_card" }));
    const state = received({ notices });
    expect(state.entries.map((toast) => [toast.id, toast.summary, toast.detail])).toEqual([
      [1, "failed open_card", "why 0"],
      [2, "failed open_card", "why 1"],
      [3, "failed open_card", "why 2"],
      [4, "failed open_card", "why 3"],
      [5, "failed open_card", "why 4"],
    ]);
    expect(state.nextId).toBe(6);
  });

  it("keeps a card's key on its toast, and none on a toast that had none", () => {
    const state = received({ notices: [{ cardKey: "ask:a", detail: "", summary: "s" }, notice({ name: "b" })] });
    expect(state.entries.map((toast) => toast.cardKey)).toEqual(["ask:a", undefined]);
  });

  it("shows three, holds the rest unclocked, and moves the next up with a full life when one is closed", () => {
    const state = received({ notices: ["a", "b", "c", "d", "e"].map((name) => notice({ name })) });
    expect(shownToasts({ state }).map((toast) => toast.summary)).toEqual(["failed a", "failed b", "failed c"]);
    expect([state.entries[3].expiresAtMs, state.entries[4].expiresAtMs]).toEqual([undefined, undefined]);
    const after = dismissToast({ id: state.entries[1].id, nowMs: 500, state });
    expect(after.entries.map((toast) => [toast.summary, toast.expiresAtMs])).toEqual([
      ["failed a", TOAST_LIFE_MS],
      ["failed c", TOAST_LIFE_MS],
      ["failed d", 500 + TOAST_LIFE_MS],
      ["failed e", undefined],
    ]);
  });

  it("moves the next up with a full life when one expires", () => {
    const state = received({ notices: ["a", "b", "c", "d"].map((name) => notice({ name })) });
    const after = expireToasts({ held: NOTHING_HELD, nowMs: TOAST_LIFE_MS, state });
    expect(after.entries.map((toast) => [toast.summary, toast.expiresAtMs])).toEqual([["failed d", 2 * TOAST_LIFE_MS]]);
  });

  it("lets a toast go when its life runs out, unless the owner is holding it", () => {
    const state = received({ notices: [notice({ name: "a" }), notice({ name: "b" })] });
    const heldA = new Set([state.entries[0].id]);
    const after = expireToasts({ held: heldA, nowMs: TOAST_LIFE_MS, state });
    expect(after.entries.map((toast) => toast.summary)).toEqual(["failed a"]);
  });

  it("returns the same stack when nothing is due", () => {
    const state = received({ notices: [notice({ name: "a" })] });
    expect(expireToasts({ held: NOTHING_HELD, nowMs: TOAST_LIFE_MS - 1, state })).toBe(state);
  });

  it("arms its timer for the earliest shown toast the owner is not holding", () => {
    const first = received({ notices: [notice({ name: "a" })] });
    const state = receiveNotice({ notice: notice({ name: "b" }), nowMs: 2000, state: first });
    expect(nextExpiryMs({ held: NOTHING_HELD, state })).toBe(TOAST_LIFE_MS);
    expect(nextExpiryMs({ held: new Set([state.entries[0].id]), state })).toBe(2000 + TOAST_LIFE_MS);
    expect(nextExpiryMs({ held: NOTHING_HELD, state: NO_TOASTS })).toBe(undefined);
  });
});
