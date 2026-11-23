/*
 * The call leg's preflight over a console's call registry beside the machine's leases. The regression it holds down:
 * the owner's idle typed conversation holds NO lease, so a lease-only preflight read it as clear and the test call's offer
 * ended it. The registry read waits it out and names it.
 */
import { describe, expect, it } from "vitest";

import { E2eCallErrors } from "../../../desktop/e2eCallErrors.js";
import { parseHeldConversations, preflightDecision } from "../../../desktop/heldConversations.js";
import { err, ok, unwrap, unwrapErr } from "../../../lib/result.js";

const URL = "http://localhost:3000/api/talk/held";
const TYPED = { id: "typed-1", surface: "typed" } as const;
const VOICE = { id: "voice-1", surface: "voice" } as const;

describe("parseHeldConversations", () => {
  it("reads the route's exact answer, and an empty one as none held", () => {
    expect([
      unwrap(parseHeldConversations({ text: JSON.stringify({ held: [TYPED, VOICE] }), url: URL })),
      unwrap(parseHeldConversations({ text: JSON.stringify({ held: [] }), url: URL })),
    ]).toEqual([[TYPED, VOICE], []]);
  });

  it("never reads a shape it does not know as none held", () => {
    const unreadable = [{}, { held: null }, { held: [{ id: "x", surface: "chat" }] }, { held: [], extra: 1 }, "ok"].map(
      (value) => unwrapErr(parseHeldConversations({ text: JSON.stringify(value), url: URL })).message,
    );
    expect(unreadable).toEqual(
      Array.from(
        { length: 5 },
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
  it("is clear only with no lease and nothing held", () => {
    expect(preflightDecision({ conversations: ok([]), leases: ok([]) })).toEqual({ kind: "clear" });
  });

  // No lease, the owner's typed conversation held.
  it("waits on a held typed conversation that carries no lease, naming it in the registry's words", () => {
    const decision = preflightDecision({ conversations: ok([TYPED]), leases: ok([]) });
    expect(decision).toEqual({ error: E2eCallErrors.conversationHeld({ held: [TYPED] }), kind: "wait" });
    expect(E2eCallErrors.conversationHeld({ held: [TYPED] }).message).toBe(
      "the console's call registry holds 1 typed conversation(s), with or without a live lease — a test call would " +
        "end a typed one or sit beside a call, so none is placed; re-run once it has ended",
    );
  });

  it("counts each surface when the registry holds a voice call and a typed conversation", () => {
    const decision = preflightDecision({ conversations: ok([VOICE, TYPED]), leases: ok([]) });
    expect(decision).toEqual({ error: E2eCallErrors.conversationHeld({ held: [VOICE, TYPED] }), kind: "wait" });
    expect(E2eCallErrors.conversationHeld({ held: [VOICE, TYPED] }).message).toContain(
      "holds 1 voice call(s) and 1 typed conversation(s)",
    );
  });

  // A lease live at preflight is not waited out, or the owner's call ending would let the leg place one straight
  // after. A live lease is the owner's call, refused at once and naming the ruling.
  it("refuses at once on a live lease alone, naming the ruling", () => {
    const decision = preflightDecision({ conversations: ok([]), leases: ok(["a", "b"]) });
    expect(decision).toEqual({ error: E2eCallErrors.callAlreadyLive({ live: 2 }), kind: "refuse" });
    expect(E2eCallErrors.callAlreadyLive({ live: 2 }).message).toContain(
      "the owner's ruling: e2e testing the desktop app holds",
    );
  });

  it("names the lease over the registry when both are occupied, and over a registry it cannot reach", () => {
    const unreachable = E2eCallErrors.conversationsUnreadable({ detail: `${URL} could not be reached` });
    expect([
      preflightDecision({ conversations: ok([VOICE, TYPED]), leases: ok(["lease-1"]) }),
      preflightDecision({ conversations: err(unreachable), leases: ok(["lease-1"]) }),
    ]).toEqual([
      { error: E2eCallErrors.callAlreadyLive({ live: 1 }), kind: "refuse" },
      { error: E2eCallErrors.callAlreadyLive({ live: 1 }), kind: "refuse" },
    ]);
  });

  it("waits on an unreachable registry, and refuses at once on unreadable leases", () => {
    const unreachable = E2eCallErrors.conversationsUnreadable({ detail: `${URL} could not be reached` });
    const leasesBad = E2eCallErrors.leasesUnreadable({ detail: "EACCES" });
    expect([
      preflightDecision({ conversations: err(unreachable), leases: ok([]) }),
      preflightDecision({ conversations: err(unreachable), leases: err(leasesBad) }),
    ]).toEqual([
      { error: unreachable, kind: "wait" },
      { error: leasesBad, kind: "refuse" },
    ]);
  });
});
