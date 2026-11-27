/*
 * The call leg's preflight over a console's call registry beside the machine's leases. The regression it holds down:
 * the owner's idle typed conversation holds NO lease, so a lease-only preflight read it as clear and the test call's offer
 * ended it. The registry read waits out one not yet at rest and names it; one at rest it runs beside, counted.
 */
import { describe, expect, it } from "vitest";

import { E2eCallErrors } from "../../../desktop/e2eCallErrors.js";
import { CALL_STEP_IDS } from "../../../desktop/e2eCallPlan.js";
import {
  besideAtRestFor,
  besideAtRestLine,
  parseHeldConversations,
  preflightDecision,
} from "../../../desktop/heldConversations.js";
import { err, ok, unwrap, unwrapErr } from "../../../lib/result.js";

const URL = "http://localhost:3000/api/talk/held";
const TYPED = { atRest: false, id: "typed-1", surface: "typed" } as const;
const TYPED_AT_REST = { atRest: true, id: "typed-2", surface: "typed" } as const;
const VOICE = { atRest: false, id: "voice-1", surface: "voice" } as const;

describe("parseHeldConversations", () => {
  it("reads the route's exact answer, and an empty one as none held", () => {
    expect([
      unwrap(parseHeldConversations({ text: JSON.stringify({ held: [TYPED, TYPED_AT_REST, VOICE] }), url: URL })),
      unwrap(parseHeldConversations({ text: JSON.stringify({ held: [] }), url: URL })),
    ]).toEqual([[TYPED, TYPED_AT_REST, VOICE], []]);
  });

  // A console built before it answered `atRest` refuses a test call beside anything, so absent must wait too.
  it("reads a row with no atRest, from a console that predates it, as not at rest", () => {
    expect(
      unwrap(
        parseHeldConversations({ text: JSON.stringify({ held: [{ id: "typed-1", surface: "typed" }] }), url: URL }),
      ),
    ).toEqual([TYPED]);
  });

  it("never reads a shape it does not know as none held", () => {
    const unreadable = [
      {},
      { held: null },
      { held: [{ id: "x", surface: "chat" }] },
      { held: [], extra: 1 },
      { held: [{ atRest: "yes", id: "x", surface: "typed" }] },
      "ok",
    ].map((value) => unwrapErr(parseHeldConversations({ text: JSON.stringify(value), url: URL })).message);
    expect(unreadable).toEqual(
      Array.from(
        { length: 6 },
        () =>
          E2eCallErrors.conversationsUnreadable({ detail: `${URL} answered a shape this build does not read` }).message,
      ),
    );
  });

  it("never reads a body that is not JSON as none held, and says it is not JSON", () => {
    expect(unwrapErr(parseHeldConversations({ text: "<html>", url: URL }))).toEqual(
      E2eCallErrors.conversationsUnreadable({ detail: `${URL} answered something that is not JSON` }),
    );
  });
});

describe("preflightDecision", () => {
  it("is clear beside nothing with no lease, counting none", () => {
    expect(preflightDecision({ besideAtRest: "allowed", conversations: ok([]), leases: ok([]) })).toEqual({
      atRestTyped: 0,
      kind: "clear",
    });
  });

  it("is clear beside typed conversations at rest, counting each it runs beside", () => {
    expect(
      preflightDecision({
        besideAtRest: "allowed",
        conversations: ok([TYPED_AT_REST, { ...TYPED_AT_REST, id: "typed-3" }]),
        leases: ok([]),
      }),
    ).toEqual({ atRestTyped: 2, kind: "clear" });
  });

  // A scenario that types into the messenger opens a typed conversation, which would replace the one at rest.
  it("waits on a typed conversation at rest before a scenario that types, naming why, and is clear beside none", () => {
    expect([
      preflightDecision({ besideAtRest: "refused", conversations: ok([TYPED_AT_REST]), leases: ok([]) }),
      preflightDecision({ besideAtRest: "refused", conversations: ok([]), leases: ok([]) }),
    ]).toEqual([
      { error: E2eCallErrors.conversationHeldForTypedOpen({ held: [TYPED_AT_REST] }), kind: "wait" },
      { atRestTyped: 0, kind: "clear" },
    ]);
    expect(E2eCallErrors.conversationHeldForTypedOpen({ held: [TYPED_AT_REST] }).message).toBe(
      "the console's call registry holds 1 conversation(s), with or without a live lease — this scenario opens a " +
        "typed conversation, which replaces every typed one held, at rest or not, so it runs beside none; re-run once " +
        "each has ended",
    );
  });

  it("still names a live lease first before a scenario that types", () => {
    expect(
      preflightDecision({ besideAtRest: "refused", conversations: ok([TYPED_AT_REST]), leases: ok(["lease-1"]) }),
    ).toEqual({ error: E2eCallErrors.callAlreadyLive({ live: 1 }), kind: "refuse" });
  });

  // No lease, the owner's typed conversation held and not yet at rest.
  it("waits on a held typed conversation not yet at rest that carries no lease, naming it in the registry's words", () => {
    const decision = preflightDecision({ besideAtRest: "allowed", conversations: ok([TYPED]), leases: ok([]) });
    expect(decision).toEqual({ error: E2eCallErrors.conversationHeld({ held: [TYPED] }), kind: "wait" });
    expect(E2eCallErrors.conversationHeld({ held: [TYPED] }).message).toBe(
      "the console's call registry holds 1 typed conversation(s) not yet at rest, with or without a live lease — a " +
        "test call runs beside nothing but a typed conversation at rest, so none is placed; re-run once it has ended " +
        "or gone quiet",
    );
  });

  it("names only what holds it, never a typed conversation at rest beside it", () => {
    expect(
      preflightDecision({ besideAtRest: "allowed", conversations: ok([TYPED_AT_REST, VOICE]), leases: ok([]) }),
    ).toEqual({
      error: E2eCallErrors.conversationHeld({ held: [VOICE] }),
      kind: "wait",
    });
  });

  // A voice row is never one to run beside, whatever its flag says.
  it("waits on a voice call even when its row says at rest", () => {
    const flagged = { ...VOICE, atRest: true };
    expect(preflightDecision({ besideAtRest: "allowed", conversations: ok([flagged]), leases: ok([]) })).toEqual({
      error: E2eCallErrors.conversationHeld({ held: [flagged] }),
      kind: "wait",
    });
  });

  it("counts each surface when the registry holds a voice call and a typed conversation", () => {
    const decision = preflightDecision({ besideAtRest: "allowed", conversations: ok([VOICE, TYPED]), leases: ok([]) });
    expect(decision).toEqual({ error: E2eCallErrors.conversationHeld({ held: [VOICE, TYPED] }), kind: "wait" });
    expect(E2eCallErrors.conversationHeld({ held: [VOICE, TYPED] }).message).toContain(
      "holds 1 voice call(s) and 1 typed conversation(s) not yet at rest",
    );
  });

  // A lease live at preflight is not waited out, or the owner's call ending would let the leg place one straight
  // after. A live lease is the owner's call, refused at once and naming the ruling.
  it("refuses at once on a live lease alone, naming the ruling", () => {
    const decision = preflightDecision({ besideAtRest: "allowed", conversations: ok([]), leases: ok(["a", "b"]) });
    expect(decision).toEqual({ error: E2eCallErrors.callAlreadyLive({ live: 2 }), kind: "refuse" });
    expect(E2eCallErrors.callAlreadyLive({ live: 2 }).message).toContain(
      "the owner's ruling: e2e testing the desktop app holds",
    );
  });

  it("names the lease over the registry when both are occupied, and over a registry it cannot reach", () => {
    const unreachable = E2eCallErrors.conversationsUnreadable({ detail: `${URL} could not be reached` });
    expect([
      preflightDecision({ besideAtRest: "allowed", conversations: ok([VOICE, TYPED]), leases: ok(["lease-1"]) }),
      preflightDecision({ besideAtRest: "allowed", conversations: ok([TYPED_AT_REST]), leases: ok(["lease-1"]) }),
      preflightDecision({ besideAtRest: "allowed", conversations: err(unreachable), leases: ok(["lease-1"]) }),
    ]).toEqual([
      { error: E2eCallErrors.callAlreadyLive({ live: 1 }), kind: "refuse" },
      { error: E2eCallErrors.callAlreadyLive({ live: 1 }), kind: "refuse" },
      { error: E2eCallErrors.callAlreadyLive({ live: 1 }), kind: "refuse" },
    ]);
  });

  it("waits on an unreachable registry, and refuses at once on unreadable leases", () => {
    const unreachable = E2eCallErrors.conversationsUnreadable({ detail: `${URL} could not be reached` });
    const leasesBad = E2eCallErrors.leasesUnreadable({ detail: "EACCES" });
    expect([
      preflightDecision({ besideAtRest: "allowed", conversations: err(unreachable), leases: ok([]) }),
      preflightDecision({ besideAtRest: "allowed", conversations: err(unreachable), leases: err(leasesBad) }),
    ]).toEqual([
      { error: unreachable, kind: "wait" },
      { error: leasesBad, kind: "refuse" },
    ]);
  });
});

describe("besideAtRestFor", () => {
  it("refuses exactly the scenarios that type into the messenger, and allows every other", () => {
    expect(CALL_STEP_IDS.length).toBeGreaterThan(0);
    expect(CALL_STEP_IDS.filter((id) => besideAtRestFor({ id }) === "refused").toSorted()).toEqual([
      "card-read",
      "card-read-typed",
      "queue-search",
      "typing-after-drop",
    ]);
  });
});

describe("besideAtRestLine", () => {
  it("says nothing beside none, and names the count it runs beside otherwise", () => {
    expect([besideAtRestLine({ atRestTyped: 0 }), besideAtRestLine({ atRestTyped: 1 })]).toEqual([
      undefined,
      "PREFLIGHT  running beside 1 typed conversation(s) at rest — each stays open and untouched, and the test call " +
        "is kept apart from it",
    ]);
  });
});
