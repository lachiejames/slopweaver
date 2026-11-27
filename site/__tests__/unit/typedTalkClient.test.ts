/*
 * How the page reads the say route's answer: only the route's own 2xx takes a message as sent, a gone conversation
 * is told apart so the page reopens once, and anything that may have reached the thread is said as possibly sent.
 */
import { describe, expect, it } from "vitest";

import {
  owedTakenBy,
  phaseAfterSend,
  sendTaken,
  typedHoldsCall,
  typedOpenBody,
  typedSendOf,
} from "../../components/voice/typedTalkClient";

describe("typedOpenBody", () => {
  it("is empty on the owner's page and carries the mark only on the desktop test instance's", () => {
    expect([typedOpenBody({ instance: undefined }), typedOpenBody({ instance: "e2e" })]).toEqual([
      "{}",
      '{"instance":"e2e"}',
    ]);
  });
});

describe("typedSendOf", () => {
  it("takes the route's own 2xx with a turn as accepted", () => {
    expect(typedSendOf({ body: { ok: true, turnId: "t-1" }, status: 200 })).toEqual({
      kind: "accepted",
      turnId: "t-1",
    });
  });

  it("never takes a 5xx as sent, whatever its body says", () => {
    expect(typedSendOf({ body: { ok: true, turnId: "t-1" }, status: 500 })).toEqual({
      kind: "unknown",
      why: "the say route answered HTTP 500",
    });
  });

  it("says a 2xx naming no turn as possibly sent", () => {
    expect(typedSendOf({ body: { ok: true, turnId: "" }, status: 200 })).toEqual({
      kind: "unknown",
      why: "the say route answered HTTP 200",
    });
  });

  it("says a 2xx it cannot read as possibly sent, never refused", () => {
    expect(typedSendOf({ body: undefined, status: 200 })).toEqual({
      kind: "unknown",
      why: "the say route answered HTTP 200",
    });
  });

  it("says an ambiguous refusal as possibly sent, in the route's words", () => {
    expect(
      typedSendOf({ body: { ambiguous: true, ok: false, refused: "the thread went quiet" }, status: 200 }),
    ).toEqual({ kind: "unknown", why: "the thread went quiet" });
  });

  it("tells a gone conversation apart", () => {
    const body = { ambiguous: false, gone: true, ok: false, refused: "no such call" };
    expect(typedSendOf({ body, status: 404 })).toEqual({
      kind: "gone",
      why: "no such call",
    });
  });

  it("says a refusal the route did not write as possibly sent, and never as gone", () => {
    expect(typedSendOf({ body: { refused: "upstream not found" }, status: 404 })).toEqual({
      kind: "unknown",
      why: "upstream not found",
    });
    expect(typedSendOf({ body: { refused: "blocked" }, status: 403 })).toEqual({ kind: "unknown", why: "blocked" });
    expect(typedSendOf({ body: { ambiguous: false, ok: false, refused: "no route" }, status: 404 })).toEqual({
      kind: "refused",
      why: "no route",
    });
  });

  it("refuses a plain refusal the route wrote", () => {
    expect(typedSendOf({ body: { ambiguous: false, ok: false, refused: "a call is up" }, status: 409 })).toEqual({
      kind: "refused",
      why: "a call is up",
    });
  });

  it("says any answer whose body cannot be read as possibly sent: the route's unknown-fate answer is a 409 too", () => {
    expect(typedSendOf({ body: undefined, status: 409 })).toEqual({
      kind: "unknown",
      why: "the say route answered HTTP 409",
    });
    expect(typedSendOf({ body: undefined, status: 400 })).toEqual({
      kind: "unknown",
      why: "the say route answered HTTP 400",
    });
  });

  it("never takes a 404 the route did not write as gone, so the message is never sent again on a fresh thread", () => {
    expect(typedSendOf({ body: undefined, status: 404 })).toEqual({
      kind: "unknown",
      why: "the say route answered HTTP 404",
    });
    expect(typedSendOf({ body: { message: "not found" }, status: 404 })).toEqual({
      kind: "unknown",
      why: "the say route answered HTTP 404",
    });
  });
});

describe("phaseAfterSend", () => {
  const none = { completed: new Set<string>(), running: new Set<string>() };

  it("is answering once a send is accepted and its turn has not ended", () => {
    expect(phaseAfterSend({ said: { kind: "accepted", turnId: "t-1" }, seen: none })).toBe("replying");
  });

  it("is open when the accepted turn's completion reached the page before the answer to its start", () => {
    const seen = { completed: new Set(["t-1"]), running: new Set<string>() };
    expect(phaseAfterSend({ said: { kind: "accepted", turnId: "t-1" }, seen })).toBe("open");
  });

  it("is answering after an unknown send while a turn the thread announced still runs, and open when none does", () => {
    const running = { completed: new Set<string>(), running: new Set(["t-1"]) };
    expect(phaseAfterSend({ said: { kind: "unknown", why: "timed out" }, seen: running })).toBe("replying");
    expect(phaseAfterSend({ said: { kind: "unknown", why: "timed out" }, seen: none })).toBe("open");
    expect(phaseAfterSend({ said: { kind: "refused", why: "a call is up" }, seen: none })).toBe("open");
  });
});

describe("sendTaken", () => {
  it("takes an accepted send, and an unknown one only when the thread announced a turn while it was out", () => {
    expect(sendTaken({ said: { kind: "accepted", turnId: "t-1" }, turnHeard: false })).toBe(true);
    expect(sendTaken({ said: { kind: "unknown", why: "HTTP 500" }, turnHeard: true })).toBe(true);
    expect(sendTaken({ said: { kind: "unknown", why: "HTTP 500" }, turnHeard: false })).toBe(false);
    expect(sendTaken({ said: { kind: "refused", why: "a call is up" }, turnHeard: true })).toBe(false);
  });
});

describe("owedTakenBy", () => {
  it("takes the next fresh turn as the owed send's, never one heard while it was out", () => {
    const owed = { messageId: "m-b", notIts: new Set(["t-a"]), text: "b" };
    expect(owedTakenBy({ owed, turnId: "t-b" })).toBe(true);
    expect(owedTakenBy({ owed, turnId: "t-a" })).toBe(false);
    expect(owedTakenBy({ owed: undefined, turnId: "t-b" })).toBe(false);
  });
});

describe("typedHoldsCall", () => {
  it("holds a call while an answer is being sent or written", () => {
    expect(typedHoldsCall({ answering: true, nowMs: 0, unsureUntilMs: undefined })).toBe(true);
    expect(typedHoldsCall({ answering: false, nowMs: 0, unsureUntilMs: undefined })).toBe(false);
  });

  it("holds a call after a send of unknown fate until its hold passes", () => {
    expect(typedHoldsCall({ answering: false, nowMs: 999, unsureUntilMs: 1000 })).toBe(true);
    expect(typedHoldsCall({ answering: false, nowMs: 1000, unsureUntilMs: 1000 })).toBe(false);
  });
});
