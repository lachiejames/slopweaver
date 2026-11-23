/*
 * The other Queue cards a relay says the owner's words also answer: only keys the owner was served this call and still holds, and
 * one bad key refuses the whole call.
 */

import { describe, expect, it } from "vitest";

import {
  ALSO_ANSWERS_MAX as CLI_ALSO_ANSWERS_MAX,
  NEVER_ALSO_ANSWERED as CLI_NEVER_ALSO_ANSWERED,
} from "../../../src/talk/cardKey";
import { toolOutputOf } from "../../components/live/talkSession";
import {
  ALSO_ANSWERS_MAX,
  alsoAnswersOf,
  alsoAnswersShapeOf,
  NEVER_ALSO_ANSWERED,
  servedThisCall,
} from "../../lib/alsoAnsweredCards";
import { UNREAD_MAX_BYTES } from "../../lib/unreadFit";

const SERVED = new Set(["ask:split-files", "ask:graphite", "draft:abc-1", "ask:gone"]);
const CURRENT = new Set(["ask:split-files", "ask:graphite", "draft:abc-1", "ask:open-one"]);

const read = (value: unknown) =>
  alsoAnswersOf({ about: "ask:open-one", currentKeys: CURRENT, servedKeys: SERVED, unread: [], value });

describe("alsoAnswersOf", () => {
  it("restates the CLI's bound and excluded kinds exactly", () => {
    expect(ALSO_ANSWERS_MAX).toBe(CLI_ALSO_ANSWERS_MAX);
    expect(NEVER_ALSO_ANSWERED).toEqual(CLI_NEVER_ALSO_ANSWERED);
  });

  it("reads an absent value as no other card", () => {
    expect(read(undefined)).toEqual({ keys: [], kind: "accepted" });
  });

  it("keeps served, current keys in the order named", () => {
    expect(read(["draft:abc-1", "ask:split-files"])).toEqual({
      keys: ["draft:abc-1", "ask:split-files"],
      kind: "accepted",
    });
  });

  it("refuses a key the latest action_items never served", () => {
    expect(read(["ask:split-files", "ask:open-one-typo"])).toEqual({
      kind: "refused",
      why: "ask:open-one-typo was neither in the action_items you last read the owner this call nor the card you put in front of them",
    });
  });

  it("refuses a served key the Queue no longer holds", () => {
    expect(read(["ask:gone"])).toEqual({ kind: "refused", why: "ask:gone is no longer on the owner's Queue" });
  });

  it("names the unread sources, never calls the card gone, when the record read behind the Queue failed", () => {
    const value = alsoAnswersOf({
      about: "ask:open-one",
      currentKeys: new Set(),
      servedKeys: SERVED,
      unread: [{ source: "the board", why: "the voice record read did not answer within 20 s" }],
      value: ["ask:graphite"],
    });
    expect(value).toEqual({
      kind: "refused",
      why: "ask:graphite is not among what has loaded; still unread: the board (the voice record read did not answer within 20 s)",
    });
  });

  it("holds a 30 KiB unread reason under the tool output cap, still naming its source", () => {
    const value = alsoAnswersOf({
      about: "ask:open-one",
      currentKeys: new Set(),
      servedKeys: SERVED,
      unread: [{ source: "autonomy acts", why: "e".repeat(30 * 1024) }],
      value: ["ask:graphite"],
    });
    expect(value.kind).toBe("refused");
    const { why } = value as { readonly why: string };
    expect(why.startsWith("ask:graphite is not among what has loaded; still unread: autonomy acts (")).toBe(true);
    expect(Buffer.byteLength(why)).toBeLessThanOrEqual(UNREAD_MAX_BYTES + 100);
    const answer = { refused: why };
    expect(toolOutputOf({ answer, tool: "relay_steer" })).toBe(JSON.stringify(answer));
  });

  it("refuses every key before any action_items was served", () => {
    const value = alsoAnswersOf({
      about: "",
      currentKeys: CURRENT,
      servedKeys: new Set(),
      unread: [],
      value: ["ask:graphite"],
    });
    expect(value).toEqual({
      kind: "refused",
      why: "ask:graphite was neither in the action_items you last read the owner this call nor the card you put in front of them",
    });
  });
});

describe("alsoAnswersShapeOf", () => {
  it("refuses the open card itself", () => {
    expect(alsoAnswersShapeOf({ about: "ask:open-one", value: ["ask:open-one"] })).toEqual({
      kind: "refused",
      why: "ask:open-one is the open card: answers_open_card says whether the owner's words answer it",
    });
  });

  it("refuses a hand step and a check-in", () => {
    expect([
      alsoAnswersShapeOf({ about: "", value: ["hand:sign-in"] }),
      alsoAnswersShapeOf({ about: "", value: ["act:merge-1"] }),
    ]).toEqual([
      { kind: "refused", why: "hand:sign-in is a kind the owner's words never answer as another card" },
      { kind: "refused", why: "act:merge-1 is a kind the owner's words never answer as another card" },
    ]);
  });

  it("takes a pull request by its repository and number, and refuses a bare number", () => {
    expect([
      alsoAnswersShapeOf({ about: "", value: ["pr:acme.widgets.42"] }),
      alsoAnswersShapeOf({ about: "", value: ["pr:42"] }),
    ]).toEqual([
      { keys: ["pr:acme.widgets.42"], kind: "accepted" },
      { kind: "refused", why: "pr:42 names no repository; a pull request's key is pr:<owner>.<repo>.<n>" },
    ]);
  });

  it("refuses a duplicate, a non-key and a non-list", () => {
    expect([
      alsoAnswersShapeOf({ about: "", value: ["ask:a", "ask:a"] }),
      alsoAnswersShapeOf({ about: "", value: ["ask:a b"] }),
      alsoAnswersShapeOf({ about: "", value: "ask:a" }),
    ]).toEqual([
      { kind: "refused", why: "ask:a is named twice in also_answers" },
      { kind: "refused", why: "each also_answers entry must be a card key such as ask:<slug>" },
      { kind: "refused", why: "also_answers must be a list of card keys" },
    ]);
  });

  it("takes exactly the bound and refuses one past it", () => {
    const five = ["ask:a", "ask:b", "ask:c", "ask:d", "ask:e"];
    expect(alsoAnswersShapeOf({ about: "", value: five })).toEqual({ keys: five, kind: "accepted" });
    expect(alsoAnswersShapeOf({ about: "", value: [...five, "ask:f"] })).toEqual({
      kind: "refused",
      why: "also_answers names 6 cards; one relay names at most 5",
    });
  });
});

// A reconnect or rollover mints a new call without a fresh press, so the bound is the call id.
describe("servedThisCall", () => {
  const held = { call: "call-a", keys: SERVED };

  it("gives the snapshot back on the call that served it", () => {
    expect(servedThisCall({ held, now: "call-a" })).toBe(SERVED);
  });

  it("serves nothing on a successor call a reconnect or rollover minted", () => {
    expect([...servedThisCall({ held, now: "call-b" })]).toEqual([]);
  });

  it("serves nothing between calls, nor before any answer was served", () => {
    expect([
      [...servedThisCall({ held, now: undefined })],
      [...servedThisCall({ held: { call: undefined, keys: new Set() }, now: "call-a" })],
    ]).toEqual([[], []]);
  });
});
